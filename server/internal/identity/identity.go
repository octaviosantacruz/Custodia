// Package identity accepts a request only with a valid identity assertion
// from Ozal: an EdDSA JWS signed with a pinned key, for this issuer and
// audience, inside its validity window and never seen before. Custodia keeps
// no login of its own and never trusts identity headers by themselves.
//
// Check is the pure core (claims and replay decision); Verifier parses and
// verifies the signature; Middleware is the HTTP shell.
package identity

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
)

// Header is where Ozal sends the assertion.
const Header = "X-Ozal-Assertion"

// MaxLifetime is the longest validity Custodia accepts from an assertion.
const MaxLifetime = 60 * time.Second

// Stable rejection codes.
const (
	Missing    = "missing"
	Malformed  = "malformed"
	UnknownKey = "unknown_key"
	Signature  = "signature"
	Issuer     = "issuer"
	Audience   = "audience"
	Expired    = "expired"
	NotYet     = "not_yet_valid"
	Lifetime   = "lifetime"
	Subject    = "subject"
	ID         = "id"
	Replayed   = "replayed"
	Capacity   = "replay_capacity"
)

// Principal is the person Ozal authorized.
type Principal struct {
	Subject string   `json:"sub"`
	Email   string   `json:"email,omitempty"`
	Name    string   `json:"name,omitempty"`
	Groups  []string `json:"groups,omitempty"`
}

type claims struct {
	Principal
	Issuer   string `json:"iss"`
	Audience string `json:"aud"`
	IssuedAt int64  `json:"iat"`
	Expiry   int64  `json:"exp"`
	ID       string `json:"jti"`
}

// Check applies the claim rules; it returns "" or a rejection code.
func check(c claims, issuer, audience string, now time.Time, skew time.Duration) string {
	switch {
	case c.Issuer == "" || c.Issuer != issuer:
		return Issuer
	case c.Audience == "" || c.Audience != audience:
		return Audience
	case strings.TrimSpace(c.Subject) == "":
		return Subject
	case strings.TrimSpace(c.ID) == "":
		return ID
	case c.Expiry-c.IssuedAt <= 0 || time.Duration(c.Expiry-c.IssuedAt)*time.Second > MaxLifetime:
		return Lifetime
	case now.Add(skew).Unix() < c.IssuedAt:
		return NotYet
	case now.Add(-skew).Unix() >= c.Expiry:
		return Expired
	}
	return ""
}

// Verifier checks assertions. It is safe for concurrent use.
type Verifier struct {
	keys     map[string]ed25519.PublicKey
	issuer   string
	audience string
	skew     time.Duration
	now      func() time.Time
	replay   *replayCache
}

// Config is what the operator pins.
type Config struct {
	Issuer     string
	Audience   string
	PublicKeys [][]byte // PEM
	Skew       time.Duration
	// MaxIDs bounds the replay cache; when full, new assertions are refused
	// until old ones expire (fail closed). Default 100000.
	MaxIDs int
}

// NewVerifier pins the keys. At least one key, an issuer and an audience
// are required.
func NewVerifier(cfg Config, now func() time.Time) (*Verifier, error) {
	if cfg.Issuer == "" || cfg.Audience == "" {
		return nil, errors.New("identity: issuer and audience are required")
	}
	if len(cfg.PublicKeys) == 0 {
		return nil, errors.New("identity: pin at least one Ozal public key")
	}
	if cfg.Skew < 0 || cfg.Skew > 30*time.Second {
		return nil, errors.New("identity: clock skew must be between 0 and 30 seconds")
	}
	if cfg.MaxIDs <= 0 {
		cfg.MaxIDs = 100_000
	}
	keys := map[string]ed25519.PublicKey{}
	for _, data := range cfg.PublicKeys {
		key, err := parsePublicKey(data)
		if err != nil {
			return nil, err
		}
		keys[keyID(key)] = key
	}
	if now == nil {
		now = time.Now
	}
	return &Verifier{keys: keys, issuer: cfg.Issuer, audience: cfg.Audience, skew: cfg.Skew, now: now, replay: &replayCache{max: cfg.MaxIDs, seen: map[string]int64{}}}, nil
}

// Verify returns the principal, or a rejection code.
func (v *Verifier) Verify(token string) (Principal, string) {
	if token == "" {
		return Principal{}, Missing
	}
	signed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.EdDSA})
	if err != nil || len(signed.Signatures) != 1 {
		return Principal{}, Malformed
	}
	key, ok := v.keys[signed.Signatures[0].Header.KeyID]
	if !ok {
		return Principal{}, UnknownKey
	}
	payload, err := signed.Verify(key)
	if err != nil {
		return Principal{}, Signature
	}
	var c claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return Principal{}, Malformed
	}
	now := v.now()
	if code := check(c, v.issuer, v.audience, now, v.skew); code != "" {
		return Principal{}, code
	}
	if code := v.replay.claim(c.ID, c.Expiry+int64(v.skew/time.Second), now.Unix()); code != "" {
		return Principal{}, code
	}
	c.Principal.Groups = slices.Clone(c.Principal.Groups)
	return c.Principal, ""
}

// replayCache remembers assertion IDs until they expire.
type replayCache struct {
	mu   sync.Mutex
	max  int
	seen map[string]int64
}

func (r *replayCache) claim(id string, until, now int64) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.seen[id]; ok {
		return Replayed
	}
	if len(r.seen) >= r.max {
		for k, exp := range r.seen {
			if exp < now {
				delete(r.seen, k)
			}
		}
		if len(r.seen) >= r.max {
			return Capacity
		}
	}
	r.seen[id] = until
	return ""
}

func keyID(public ed25519.PublicKey) string {
	sum := sha256.Sum256(public)
	return hex.EncodeToString(sum[:16])
}

func parsePublicKey(data []byte) (ed25519.PublicKey, error) {
	block, _ := pem.Decode(data)
	if block == nil || block.Type != "PUBLIC KEY" {
		return nil, errors.New("identity: an Ozal public key must be a PEM PUBLIC KEY")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, errors.New("identity: an Ozal public key cannot be parsed")
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("identity: an Ozal public key must be Ed25519")
	}
	return key, nil
}
