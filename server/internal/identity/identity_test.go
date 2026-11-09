package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
)

const (
	iss = "https://auth.example.com"
	aud = "custodia"
)

var t0 = time.Unix(1_800_000_000, 0)

type ozal struct {
	key ed25519.PrivateKey
	pem []byte
}

func newOzal(t *testing.T) ozal {
	t.Helper()
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(public)
	return ozal{key: key, pem: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})}
}

// sign mirrors Ozal's internal/assertion: EdDSA JWS with kid = key ID.
func (o ozal) sign(t *testing.T, c map[string]any) string {
	t.Helper()
	opts := (&jose.SignerOptions{}).WithType("JWT").WithHeader(jose.HeaderKey("kid"), keyID(o.key.Public().(ed25519.PublicKey)))
	s, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.EdDSA, Key: o.key}, opts)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(c)
	jws, err := s.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := jws.CompactSerialize()
	return out
}

func claimsAt(at time.Time, id string) map[string]any {
	return map[string]any{"iss": iss, "aud": aud, "sub": "passkey:alice", "email": "alice@acme.example", "groups": []string{"security"},
		"iat": at.Unix(), "exp": at.Add(60 * time.Second).Unix(), "jti": id}
}

func verifier(t *testing.T, o ozal, now *time.Time) *Verifier {
	t.Helper()
	v, err := NewVerifier(Config{Issuer: iss, Audience: aud, PublicKeys: [][]byte{o.pem}, Skew: 5 * time.Second}, func() time.Time { return *now })
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestVerify(t *testing.T) {
	o, other := newOzal(t), newOzal(t)
	now := t0
	v := verifier(t, o, &now)
	p, code := v.Verify(o.sign(t, claimsAt(t0, "a")))
	if code != "" || p.Subject != "passkey:alice" || p.Email != "alice@acme.example" || len(p.Groups) != 1 {
		t.Fatalf("valid assertion: %+v %q", p, code)
	}
	mutate := func(f func(map[string]any)) map[string]any {
		c := claimsAt(t0, "x"+time.Now().String())
		f(c)
		return c
	}
	for _, tc := range []struct {
		name  string
		token func() string
		at    time.Time
		want  string
	}{
		{"missing", func() string { return "" }, t0, Missing},
		{"garbage", func() string { return "a.b.c" }, t0, Malformed},
		{"unsigned alg none", func() string { return "eyJhbGciOiJub25lIn0.eyJzdWIiOiJyb290In0." }, t0, Malformed},
		{"unpinned key", func() string { return other.sign(t, claimsAt(t0, "o")) }, t0, UnknownKey},
		{"other issuer", func() string { return o.sign(t, mutate(func(c map[string]any) { c["iss"] = "https://evil.example" })) }, t0, Issuer},
		{"other audience", func() string { return o.sign(t, mutate(func(c map[string]any) { c["aud"] = "billing" })) }, t0, Audience},
		{"no subject", func() string { return o.sign(t, mutate(func(c map[string]any) { c["sub"] = "" })) }, t0, Subject},
		{"no id", func() string { return o.sign(t, mutate(func(c map[string]any) { c["jti"] = "" })) }, t0, ID},
		{"hour-long", func() string {
			return o.sign(t, mutate(func(c map[string]any) { c["exp"] = t0.Add(time.Hour).Unix() }))
		}, t0, Lifetime},
		{"expired", func() string { return o.sign(t, claimsAt(t0, "e")) }, t0.Add(66 * time.Second), Expired},
		{"from the future", func() string { return o.sign(t, claimsAt(t0.Add(time.Minute), "f")) }, t0, NotYet},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now = tc.at
			if _, code := v.Verify(tc.token()); code != tc.want {
				t.Fatalf("code = %q, want %q", code, tc.want)
			}
		})
	}
	now = t0
	token := o.sign(t, claimsAt(t0, "once"))
	if _, code := v.Verify(token); code != "" {
		t.Fatal(code)
	}
	if _, code := v.Verify(token); code != Replayed {
		t.Fatalf("replay = %q", code)
	}
}

func TestReplayCacheFailsClosedWhenFull(t *testing.T) {
	o := newOzal(t)
	now := t0
	v, _ := NewVerifier(Config{Issuer: iss, Audience: aud, PublicKeys: [][]byte{o.pem}, MaxIDs: 2}, func() time.Time { return now })
	for _, id := range []string{"1", "2"} {
		if _, code := v.Verify(o.sign(t, claimsAt(t0, id))); code != "" {
			t.Fatal(code)
		}
	}
	if _, code := v.Verify(o.sign(t, claimsAt(t0, "3"))); code != Capacity {
		t.Fatalf("full cache = %q", code)
	}
	now = t0.Add(2 * time.Minute)
	if _, code := v.Verify(o.sign(t, claimsAt(now, "4"))); code != "" {
		t.Fatalf("after expiry = %q", code)
	}
}

func TestMiddleware(t *testing.T) {
	o := newOzal(t)
	now := t0
	v := verifier(t, o, &now)
	reached := false
	h := Middleware(v, Readers{Groups: []string{"security"}}, nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := From(r.Context())
		reached = ok && p.Email == "alice@acme.example"
	}))
	serve := func(peer string, tokens ...string) int {
		req := httptest.NewRequest("GET", "/api/chains/person", nil)
		req.RemoteAddr = peer
		for _, tk := range tokens {
			req.Header.Add(Header, tk)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := serve("127.0.0.1:5000", o.sign(t, claimsAt(t0, "m1"))); code != 200 || !reached {
		t.Fatalf("valid = %d, reached %v", code, reached)
	}
	reached = false
	if code := serve("192.0.2.10:5000", o.sign(t, claimsAt(t0, "m2"))); code != 401 || reached {
		t.Fatalf("direct access = %d", code)
	}
	if code := serve("127.0.0.1:5000"); code != 401 {
		t.Fatalf("no assertion = %d", code)
	}
	if code := serve("[::1]:5000", o.sign(t, claimsAt(t0, "m3")), o.sign(t, claimsAt(t0, "m4"))); code != 401 {
		t.Fatalf("two assertions = %d", code)
	}
	outsider := claimsAt(t0, "m5")
	outsider["groups"] = []string{"finance"}
	outsider["email"] = "frank@acme.example"
	if code := serve("127.0.0.1:5000", o.sign(t, outsider)); code != 403 || reached {
		t.Fatalf("not a reader = %d", code)
	}
	if !(Readers{Emails: []string{" Frank@Acme.example"}}).Allows(Principal{Email: "frank@acme.example"}) {
		t.Fatal("email allowlist")
	}
}

func TestNewVerifierRefusesWeakSetups(t *testing.T) {
	o := newOzal(t)
	for name, cfg := range map[string]Config{
		"no key":      {Issuer: iss, Audience: aud},
		"no issuer":   {Audience: aud, PublicKeys: [][]byte{o.pem}},
		"no audience": {Issuer: iss, PublicKeys: [][]byte{o.pem}},
		"huge skew":   {Issuer: iss, Audience: aud, PublicKeys: [][]byte{o.pem}, Skew: time.Hour},
		"not a key":   {Issuer: iss, Audience: aud, PublicKeys: [][]byte{[]byte("nope")}},
	} {
		if _, err := NewVerifier(cfg, nil); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}
