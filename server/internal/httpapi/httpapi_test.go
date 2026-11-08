package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"

	"github.com/octaviosantacruz/Custodia/server/internal/identity"
	"github.com/octaviosantacruz/Custodia/server/internal/inventory"
	"github.com/octaviosantacruz/Custodia/server/internal/people"
)

type fixed struct{ snap people.Snapshot }

func (f fixed) Snapshot(context.Context) (people.Snapshot, error) { return f.snap, nil }

type harness struct {
	handler http.Handler
	key     ed25519.PrivateKey
	n       int
	asOf    time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	raw, err := os.ReadFile("../../../web/src/demo/model/company.json")
	if err != nil {
		t.Fatal(err)
	}
	asOf, _ := inventory.AcmeAsOf(raw)
	company, conns, runs, obs, err := inventory.AcmeSeed(raw, 0)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := inventory.Assemble(company, asOf, conns, runs, obs)
	if err != nil {
		t.Fatal(err)
	}
	public, key, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	v, err := identity.NewVerifier(identity.Config{Issuer: "https://auth.example.com", Audience: "custodia",
		PublicKeys: [][]byte{pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})}}, func() time.Time { return asOf })
	if err != nil {
		t.Fatal(err)
	}
	web := t.TempDir()
	os.WriteFile(filepath.Join(web, "index.html"), []byte("<!doctype html><title>Custodia</title>"), 0o644)
	os.MkdirAll(filepath.Join(web, "assets"), 0o755)
	os.WriteFile(filepath.Join(web, "assets", "app.js"), []byte("console.log(1)"), 0o644)
	s := &Server{Source: fixed{snap}, WebDir: web, Verifier: v, Readers: identity.Readers{Groups: []string{"security"}}}
	return &harness{handler: s.Handler(), key: key, asOf: asOf}
}

func (h *harness) token(t *testing.T) string {
	t.Helper()
	h.n++
	sum := sha256.Sum256(h.key.Public().(ed25519.PublicKey))
	opts := (&jose.SignerOptions{}).WithType("JWT").WithHeader(jose.HeaderKey("kid"), hex.EncodeToString(sum[:16]))
	signer, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.EdDSA, Key: h.key}, opts)
	payload, _ := json.Marshal(map[string]any{"iss": "https://auth.example.com", "aud": "custodia", "sub": "passkey:op", "email": "op@acme.example",
		"groups": []string{"security"}, "iat": h.asOf.Unix(), "exp": h.asOf.Add(time.Minute).Unix(), "jti": "id-" + time.Now().String() + string(rune('a'+h.n))})
	jws, _ := signer.Sign(payload)
	out, _ := jws.CompactSerialize()
	return out
}

func (h *harness) get(t *testing.T, path string, signed bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	req.RemoteAddr = "127.0.0.1:40000"
	if signed {
		req.Header.Set(identity.Header, h.token(t))
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func TestAPIMatchesTheDemoBehindTheAssertion(t *testing.T) {
	h := newHarness(t)
	for path, golden := range map[string]string{
		"/api/chains/person/coverage":                                      "coverage.json",
		"/api/chains/person/search?q=BOB":                                  "search-bob.json",
		"/api/chains/person?email=alice.morgan@acme.example":               "person-alice.morgan.json",
		"/api/chains/person/coverage/detail?email=eve.taylor@acme.example": "coverage-eve.taylor.json",
		"/api/chains/person?email=nobody@acme.example":                     "person-unknown.json",
	} {
		if rec := h.get(t, path, false); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without an assertion = %d", path, rec.Code)
		}
		rec := h.get(t, path, true)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s = %d %s", path, rec.Code, rec.Body)
		}
		var got, want any
		json.Unmarshal(rec.Body.Bytes(), &got)
		data, _ := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", golden))
		json.Unmarshal(data, &want)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s differs from %s:\n%s", path, golden, rec.Body)
		}
	}
	if rec := h.get(t, "/api/chains/person/coverage/detail?email=nobody@acme.example", true); rec.Code != 200 || rec.Body.String() != "null\n" {
		t.Fatalf("unknown coverage = %d %q", rec.Code, rec.Body)
	}
}

func TestAuthStatusAndUnsupportedRoutes(t *testing.T) {
	h := newHarness(t)
	var status map[string]any
	rec := h.get(t, "/api/auth/status", true)
	json.Unmarshal(rec.Body.Bytes(), &status)
	user := status["user"].(map[string]any)
	if status["authenticated"] != true || user["email"] != "op@acme.example" || user["actor_id"] != "passkey:op" {
		t.Fatalf("auth status = %s", rec.Body)
	}
	perms := status["permissions"].([]any)
	if len(perms) != 2 || perms[0] != "domain:cross" || perms[1] != "people:read" {
		t.Fatalf("permissions = %v", perms)
	}
	if rec := h.get(t, "/api/safes", true); rec.Code != http.StatusNotImplemented {
		t.Fatalf("unsupported route = %d", rec.Code)
	}
	if rec := h.get(t, "/healthz", false); rec.Code != 200 {
		t.Fatalf("healthz = %d", rec.Code)
	}
}

func TestStaticFrontendIsProtectedAndFallsBackToIndex(t *testing.T) {
	h := newHarness(t)
	if rec := h.get(t, "/chains/person", false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("frontend without an assertion = %d", rec.Code)
	}
	if rec := h.get(t, "/chains/person", true); rec.Code != 200 || rec.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("client route = %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec := h.get(t, "/assets/app.js", true); rec.Code != 200 || rec.Header().Get("Cache-Control") == "" {
		t.Fatalf("asset = %d", rec.Code)
	}
	for _, p := range []string{"/assets/missing.js", "/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"} {
		if rec := h.get(t, p, true); rec.Code == 200 && rec.Body.String() != "<!doctype html><title>Custodia</title>" {
			t.Fatalf("%s served %q", p, rec.Body)
		}
	}
}

func TestPreferencesAndEmptyFeeds(t *testing.T) {
	h := newHarness(t)
	if rec := h.get(t, "/api/workspaces/preferences", true); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"visible_workspaces":["person"]`) {
		t.Fatalf("default preferences = %d %s", rec.Code, rec.Body)
	}
	put := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("PUT", "/api/workspaces/preferences", strings.NewReader(body))
		req.RemoteAddr = "127.0.0.1:40000"
		req.Header.Set(identity.Header, h.token(t))
		rec := httptest.NewRecorder()
		h.handler.ServeHTTP(rec, req)
		return rec
	}
	if rec := put(`{"recent_workspaces":["person"]}`); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"recent_workspaces":["person"]`) {
		t.Fatalf("put = %d %s", rec.Code, rec.Body)
	}
	if rec := h.get(t, "/api/workspaces/preferences", true); !strings.Contains(rec.Body.String(), `"recent_workspaces":["person"]`) {
		t.Fatalf("not kept: %s", rec.Body)
	}
	if rec := put(`{"recent_workspaces":["<script>"]}`); rec.Code != 400 {
		t.Fatalf("invalid workspace accepted: %d", rec.Code)
	}
	for _, p := range []string{"/api/events?since=0", "/api/ingestion/schedules"} {
		if rec := h.get(t, p, true); rec.Code != 200 || rec.Body.String() != "{\"rows\":[]}\n" {
			t.Fatalf("%s = %d %s", p, rec.Code, rec.Body)
		}
	}
}
