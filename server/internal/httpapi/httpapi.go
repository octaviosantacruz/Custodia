// Package httpapi serves the frontend's API for the People view, and the
// built frontend itself, behind identity.Middleware. Routes this version does
// not serve answer 501 with a JSON reason, never a guess or an empty list.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/octaviosantacruz/Custodia/server/internal/identity"
	"github.com/octaviosantacruz/Custodia/server/internal/people"
)

// Source loads the current snapshot. The store and inventory.Assemble
// implement it; tests pass a fixed one.
type Source interface {
	Snapshot(ctx context.Context) (people.Snapshot, error)
}

// readPermissions are what a reader gets in this version. With any domain:*
// grant the frontend shows only the domains named, and each view checks its
// own permission: People (people:read) is the only view this server answers.
var readPermissions = []string{"domain:cross", "people:read"}

// Server is the API and the static frontend.
type Server struct {
	Source   Source
	WebDir   string // built frontend (web/dist); empty serves the API only
	Logger   *slog.Logger
	Verifier *identity.Verifier
	Readers  identity.Readers

	prefsMu sync.Mutex
	prefs   map[string]preferences // by subject; kept in memory in this version
}

type preferences struct {
	Visible   []string `json:"visible_workspaces"`
	Hidden    []string `json:"hidden_workspaces"`
	Recent    []string `json:"recent_workspaces"`
	UpdatedAt *string  `json:"updated_at"`
}

func (s *Server) currentPreferences(subject string) preferences {
	if p, ok := s.prefs[subject]; ok {
		return p
	}
	return preferences{Visible: []string{"person"}, Hidden: []string{}, Recent: []string{}}
}

func (s *Server) getPreferences(w http.ResponseWriter, r *http.Request) {
	p, _ := identity.From(r.Context())
	s.prefsMu.Lock()
	defer s.prefsMu.Unlock()
	writeJSON(w, http.StatusOK, s.currentPreferences(p.Subject))
}

// putPreferences merges the lists the frontend sends: workspace IDs only,
// bounded, so a client cannot grow the server's memory.
func (s *Server) putPreferences(w http.ResponseWriter, r *http.Request) {
	p, _ := identity.From(r.Context())
	var in struct {
		Visible *[]string `json:"visible_workspaces"`
		Hidden  *[]string `json:"hidden_workspaces"`
		Recent  *[]string `json:"recent_workspaces"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid preferences."})
		return
	}
	for _, list := range []*[]string{in.Visible, in.Hidden, in.Recent} {
		if list == nil {
			continue
		}
		if len(*list) > 64 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Too many workspaces."})
			return
		}
		for _, id := range *list {
			if !workspaceID(id) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid workspace."})
				return
			}
		}
	}
	s.prefsMu.Lock()
	defer s.prefsMu.Unlock()
	if s.prefs == nil {
		s.prefs = map[string]preferences{}
	}
	current := s.currentPreferences(p.Subject)
	if in.Visible != nil {
		current.Visible = *in.Visible
	}
	if in.Hidden != nil {
		current.Hidden = *in.Hidden
	}
	if in.Recent != nil {
		current.Recent = *in.Recent
	}
	now := time.Now().UTC().Format(time.RFC3339)
	current.UpdatedAt = &now
	if len(s.prefs) < 10_000 {
		s.prefs[p.Subject] = current
	}
	writeJSON(w, http.StatusOK, current)
}

func workspaceID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// Handler returns the full handler: /healthz open (for Ozal's health check,
// it reveals nothing), everything else behind the identity middleware.
func (s *Server) Handler() http.Handler {
	logger := s.Logger
	if logger == nil {
		logger = slog.Default()
	}
	api := http.NewServeMux()
	api.HandleFunc("GET /api/auth/status", s.authStatus)
	api.HandleFunc("GET /api/workspaces/preferences", s.getPreferences)
	api.HandleFunc("PUT /api/workspaces/preferences", s.putPreferences)
	// No activity feed and no scheduled syncs exist in this version: an
	// empty list is the truth, not a placeholder.
	api.HandleFunc("GET /api/events", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}})
	})
	api.HandleFunc("GET /api/ingestion/schedules", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}})
	})
	api.HandleFunc("GET /api/chains/person/search", s.withSnapshot(func(snap people.Snapshot, r *http.Request) (any, int) {
		q := r.URL.Query().Get("q")
		if q == "" {
			q = r.URL.Query().Get("search")
		}
		return snap.Search(q), http.StatusOK
	}))
	api.HandleFunc("GET /api/chains/person", s.withSnapshot(func(snap people.Snapshot, r *http.Request) (any, int) {
		return snap.Summary(r.URL.Query().Get("email")), http.StatusOK
	}))
	api.HandleFunc("GET /api/chains/person/coverage", s.withSnapshot(func(snap people.Snapshot, _ *http.Request) (any, int) {
		return snap.CoverageSummary(), http.StatusOK
	}))
	api.HandleFunc("GET /api/chains/person/coverage/detail", s.withSnapshot(func(snap people.Snapshot, r *http.Request) (any, int) {
		p, ok := snap.Find(r.URL.Query().Get("email"))
		if !ok {
			return nil, http.StatusOK
		}
		return snap.CoverageOf(p), http.StatusOK
	}))
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Not available in this Custodia version."})
	})
	api.HandleFunc("/", s.static)

	protected := identity.Middleware(s.Verifier, s.Readers, logger, api)
	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	root.Handle("/", protected)
	return securityHeaders(root)
}

func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	p, _ := identity.From(r.Context())
	name := p.Name
	if name == "" {
		name = p.Email
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mode": "oidc", "authenticated": true, "permissions": readPermissions, "api_docs_enabled": false,
		"user": map[string]any{"actor_id": p.Subject, "name": name, "email": p.Email, "roles": []string{"reader"},
			"role_names": []string{"Lector"}, "auth_source": "oidc"},
	})
}

func (s *Server) withSnapshot(build func(people.Snapshot, *http.Request) (any, int)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		snap, err := s.Source.Snapshot(ctx)
		if err != nil {
			s.logger().LogAttrs(r.Context(), slog.LevelError, "inventory.unavailable", slog.String("error", err.Error()))
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "The inventory is unavailable right now."})
			return
		}
		body, status := build(snap, r)
		writeJSON(w, status, body)
	}
}

func (s *Server) logger() *slog.Logger {
	if s.Logger != nil {
		return s.Logger
	}
	return slog.Default()
}

// static serves the built frontend; unknown paths without an extension get
// index.html (client-side routes).
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if s.WebDir == "" || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.NotFound(w, r)
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	file := filepath.Join(s.WebDir, filepath.FromSlash(clean))
	if info, err := os.Stat(file); err == nil && !info.IsDir() {
		if strings.HasPrefix(clean, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFile(w, r, file)
		return
	}
	if path.Ext(clean) != "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(s.WebDir, "index.html"))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
