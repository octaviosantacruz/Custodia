// Command custodia is the composition root: configuration, the PostgreSQL
// store, the identity verifier and the HTTP server. Subcommands:
//
//	custodia serve      -config FILE
//	custodia migrate up -config FILE
//	custodia seed demo  -config FILE [-fixture PATH]
//	custodia version
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/octaviosantacruz/Custodia/server/internal/httpapi"
	"github.com/octaviosantacruz/Custodia/server/internal/identity"
	"github.com/octaviosantacruz/Custodia/server/internal/inventory"
	"github.com/octaviosantacruz/Custodia/server/internal/people"
	"github.com/octaviosantacruz/Custodia/server/internal/store/postgres"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "custodia:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out io.Writer) error {
	usage := errors.New("usage: custodia serve|migrate up|seed demo|version -config FILE")
	if len(args) == 0 {
		return usage
	}
	switch {
	case args[0] == "version":
		_, err := fmt.Fprintln(out, version)
		return err
	case args[0] == "serve":
		return serve(ctx, args[1:], out)
	case args[0] == "migrate" && len(args) > 1 && args[1] == "up":
		return migrate(ctx, args[2:], out)
	case args[0] == "seed" && len(args) > 1 && args[1] == "demo":
		return seedDemo(ctx, args[2:], out)
	}
	return usage
}

// Config is the operator's file. Secrets are file: or env: references.
type Config struct {
	Listen      string `json:"listen"`
	DatabaseURL string `json:"database_url"`
	WebDir      string `json:"web_dir,omitempty"`
	Ozal        struct {
		Issuer         string   `json:"issuer"`
		Audience       string   `json:"audience"`
		PublicKeys     []string `json:"public_keys"`
		MaxSkewSeconds int      `json:"max_skew_seconds"`
	} `json:"ozal"`
	Readers struct {
		Groups []string `json:"groups"`
		Emails []string `json:"emails"`
	} `json:"readers"`
}

func loadConfig(path string) (Config, error) {
	var cfg Config
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("read config: %w", err)
	}
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		return cfg, fmt.Errorf("config: %w", err)
	}
	if cfg.Listen == "" {
		cfg.Listen = "127.0.0.1:8090"
	}
	host, _, err := net.SplitHostPort(cfg.Listen)
	if ip := net.ParseIP(host); err != nil || ip == nil || !ip.IsLoopback() {
		return cfg, errors.New("config: listen must be a loopback IP:port; Custodia is reached only through Ozal")
	}
	if !strings.HasPrefix(cfg.DatabaseURL, "env:") && !strings.HasPrefix(cfg.DatabaseURL, "file:") {
		return cfg, errors.New("config: database_url must be an env: or file: reference")
	}
	return cfg, nil
}

func resolve(ref string) (string, error) {
	switch {
	case strings.HasPrefix(ref, "env:"):
		value := os.Getenv(strings.TrimPrefix(ref, "env:"))
		if value == "" {
			return "", fmt.Errorf("%s is empty", ref)
		}
		return value, nil
	case strings.HasPrefix(ref, "file:"):
		data, err := os.ReadFile(strings.TrimPrefix(ref, "file:"))
		if err != nil {
			return "", fmt.Errorf("read %s: %w", ref, err)
		}
		return strings.TrimSpace(string(data)), nil
	}
	return "", errors.New("not a secret reference")
}

func configFlag(name string, args []string, out io.Writer, extra func(*flag.FlagSet)) (*flag.FlagSet, *string, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(out)
	path := fs.String("config", "custodia.json", "configuration file")
	if extra != nil {
		extra(fs)
	}
	if err := fs.Parse(args); err != nil {
		return nil, nil, err
	}
	if fs.NArg() != 0 {
		return nil, nil, errors.New("unexpected arguments")
	}
	return fs, path, nil
}

func databaseURL(path string) (Config, string, error) {
	cfg, err := loadConfig(path)
	if err != nil {
		return cfg, "", err
	}
	url, err := resolve(cfg.DatabaseURL)
	if err != nil {
		return cfg, "", fmt.Errorf("database_url: %w", err)
	}
	return cfg, url, nil
}

func migrate(ctx context.Context, args []string, out io.Writer) error {
	_, path, err := configFlag("migrate up", args, out, nil)
	if err != nil {
		return err
	}
	_, url, err := databaseURL(*path)
	if err != nil {
		return err
	}
	v, err := postgres.Migrate(ctx, url)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "schema at version %d\n", v)
	return err
}

func seedDemo(ctx context.Context, args []string, out io.Writer) error {
	var fixture *string
	_, path, err := configFlag("seed demo", args, out, func(fs *flag.FlagSet) {
		fixture = fs.String("fixture", "web/src/demo/model/company.json", "fictional company fixture")
	})
	if err != nil {
		return err
	}
	_, url, err := databaseURL(*path)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(*fixture)
	if err != nil {
		return fmt.Errorf("read fixture: %w", err)
	}
	asOf, err := inventory.AcmeAsOf(raw)
	if err != nil {
		return err
	}
	// Captured an hour before now, like the published demo.
	shift := time.Now().UTC().Truncate(time.Hour).Sub(asOf)
	company, conns, runs, obs, err := inventory.AcmeSeed(raw, shift)
	if err != nil {
		return err
	}
	store, err := postgres.Open(ctx, url, 2)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.Seed(ctx, company, conns, runs, obs); err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "seeded %s: %d connections, %d observations (synthetic)\n", company, len(conns), len(obs))
	return err
}

type storeSource struct{ store *postgres.Store }

func (s storeSource) Snapshot(ctx context.Context) (people.Snapshot, error) {
	company, conns, runs, obs, err := s.store.Load(ctx)
	if err != nil {
		return people.Snapshot{}, err
	}
	return inventory.Assemble(company, time.Now().UTC(), conns, runs, obs)
}

func serve(ctx context.Context, args []string, out io.Writer) error {
	_, path, err := configFlag("serve", args, out, nil)
	if err != nil {
		return err
	}
	cfg, url, err := databaseURL(*path)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if pending, err := postgres.Pending(ctx, url); err != nil {
		return err
	} else if pending > 0 {
		return fmt.Errorf("%d migrations pending: run custodia migrate up", pending)
	}
	var keys [][]byte
	for _, file := range cfg.Ozal.PublicKeys {
		data, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("ozal public key: %w", err)
		}
		keys = append(keys, data)
	}
	verifier, err := identity.NewVerifier(identity.Config{Issuer: cfg.Ozal.Issuer, Audience: cfg.Ozal.Audience, PublicKeys: keys,
		Skew: time.Duration(cfg.Ozal.MaxSkewSeconds) * time.Second}, nil)
	if err != nil {
		return err
	}
	store, err := postgres.Open(ctx, url, 8)
	if err != nil {
		return err
	}
	defer store.Close()
	api := &httpapi.Server{Source: storeSource{store}, WebDir: cfg.WebDir, Logger: logger, Verifier: verifier,
		Readers: identity.Readers{Groups: cfg.Readers.Groups, Emails: cfg.Readers.Emails}}
	srv := &http.Server{Addr: cfg.Listen, Handler: api.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: time.Minute}
	errs := make(chan error, 1)
	go func() { errs <- srv.ListenAndServe() }()
	logger.Info("custodia.listening", slog.String("listen", cfg.Listen), slog.String("version", version))
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}
