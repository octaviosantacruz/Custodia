package identity

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"slices"
	"strings"
)

type principalKey struct{}

// From returns the principal Middleware accepted.
func From(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}

// Readers decides who may read in this version: anyone in Groups or with an
// email in Emails. Roles and per-connection scopes come later.
type Readers struct {
	Groups []string
	Emails []string
}

// Allows reports whether p may read.
func (r Readers) Allows(p Principal) bool {
	for _, g := range p.Groups {
		if slices.Contains(r.Groups, g) {
			return true
		}
	}
	email := strings.ToLower(strings.TrimSpace(p.Email))
	for _, e := range r.Emails {
		if email != "" && strings.EqualFold(strings.TrimSpace(e), email) {
			return true
		}
	}
	return false
}

// Middleware admits a request only from a loopback peer (Ozal on this host)
// that carries a valid assertion for a reader. Both conditions hold: the
// peer check closes direct access, the assertion is the identity. Any
// failure answers 401/403 with a stable code and no data.
func Middleware(v *Verifier, readers Readers, logger *slog.Logger, next http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !loopbackPeer(r.RemoteAddr) {
			deny(w, r, logger, http.StatusUnauthorized, "not_through_ozal")
			return
		}
		values := r.Header.Values(Header)
		token := ""
		if len(values) == 1 {
			token = values[0]
		} else if len(values) > 1 {
			deny(w, r, logger, http.StatusUnauthorized, Malformed)
			return
		}
		p, code := v.Verify(token)
		if code != "" {
			deny(w, r, logger, http.StatusUnauthorized, code)
			return
		}
		if !readers.Allows(p) {
			deny(w, r, logger, http.StatusForbidden, "not_a_reader")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
	})
}

func deny(w http.ResponseWriter, r *http.Request, logger *slog.Logger, status int, code string) {
	// The code is logged, never the token.
	logger.LogAttrs(r.Context(), slog.LevelWarn, "identity.denied", slog.String("code", code), slog.String("path", r.URL.Path))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"detail":"` + code + `"}`))
}

func loopbackPeer(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
