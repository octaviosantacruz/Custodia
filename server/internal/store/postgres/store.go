// Package postgres stores Custodia's inventory in PostgreSQL. It is an
// adapter: it moves inventory types in and out of SQL and decides nothing.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/octaviosantacruz/Custodia/server/internal/inventory"
	"github.com/octaviosantacruz/Custodia/server/migrations"
)

// Migrate applies every pending migration. It is the only writer of the
// schema; the server checks the version and refuses to start when it lags.
func Migrate(ctx context.Context, url string) (int64, error) {
	db, err := openSQL(url)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		return 0, err
	}
	if _, err := provider.Up(ctx); err != nil {
		return 0, fmt.Errorf("migrate: %w", err)
	}
	return provider.GetDBVersion(ctx)
}

// Pending reports how many migrations are not applied yet.
func Pending(ctx context.Context, url string) (int, error) {
	db, err := openSQL(url)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		return 0, err
	}
	status, err := provider.Status(ctx)
	if err != nil {
		return 0, err
	}
	pending := 0
	for _, s := range status {
		if s.State == goose.StatePending {
			pending++
		}
	}
	return pending, nil
}

func openSQL(url string) (*sql.DB, error) {
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		return nil, errors.New("postgres: invalid database_url")
	}
	return stdlib.OpenDB(*cfg), nil
}

// Store reads and writes the inventory through a bounded pool.
type Store struct{ pool *pgxpool.Pool }

// Open connects with at most maxConns connections.
func Open(ctx context.Context, url string, maxConns int32) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("postgres: invalid database_url")
	}
	if maxConns > 0 {
		cfg.MaxConns = maxConns
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// Ping checks the database.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Seed writes connections, runs and observations in one transaction. It is
// idempotent: the same seed again changes nothing and duplicates nothing.
func (s *Store) Seed(ctx context.Context, company string, conns []inventory.Connection, runs []inventory.Run, obs []inventory.Observation) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a committed transaction ignores it
	if _, err := tx.Exec(ctx, `INSERT INTO settings (key, value) VALUES ('company', $1)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, company); err != nil {
		return err
	}
	connID := map[string]int64{}
	for _, c := range conns {
		var id int64
		if err := tx.QueryRow(ctx, `INSERT INTO connections (name, source, synthetic) VALUES ($1, $2, $3)
			ON CONFLICT (name) DO UPDATE SET source = EXCLUDED.source, synthetic = EXCLUDED.synthetic
			RETURNING id`, c.Name, c.Source, c.Synthetic).Scan(&id); err != nil {
			return err
		}
		connID[c.Name] = id
	}
	runID := map[string]int64{}
	for _, r := range runs {
		cid, ok := connID[r.Connection]
		if !ok {
			return fmt.Errorf("seed: run for unknown connection %s", r.Connection)
		}
		var id int64
		if err := tx.QueryRow(ctx, `INSERT INTO runs (connection_id, label, system, file, status, started_at, completed_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (connection_id, label) DO UPDATE SET system = EXCLUDED.system, file = EXCLUDED.file,
				status = EXCLUDED.status, started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at
			RETURNING id`, cid, r.Label, r.System, r.File, r.Status, r.StartedAt, r.CompletedAt).Scan(&id); err != nil {
			return err
		}
		runID[r.Connection] = id
	}
	for _, o := range obs {
		cid, ok := connID[o.Connection]
		if !ok {
			return fmt.Errorf("seed: observation for unknown connection %s", o.Connection)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO observations (connection_id, collection, external_id, schema_version, attrs, observed_at, run_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (connection_id, collection, external_id) DO UPDATE SET schema_version = EXCLUDED.schema_version,
				attrs = EXCLUDED.attrs, observed_at = EXCLUDED.observed_at, run_id = EXCLUDED.run_id`,
			cid, o.Collection, o.ExternalID, o.Schema, string(o.Attrs), o.ObservedAt, runID[o.Connection]); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Load reads everything the People view needs, in one snapshot transaction.
func (s *Store) Load(ctx context.Context) (string, []inventory.Connection, []inventory.Run, []inventory.Observation, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return "", nil, nil, nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // read-only
	var company string
	if err := tx.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'company'`).Scan(&company); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil, nil, err
	}
	var conns []inventory.Connection
	rows, err := tx.Query(ctx, `SELECT name, source, synthetic FROM connections ORDER BY id`)
	if err != nil {
		return "", nil, nil, nil, err
	}
	for rows.Next() {
		var c inventory.Connection
		if err := rows.Scan(&c.Name, &c.Source, &c.Synthetic); err != nil {
			return "", nil, nil, nil, err
		}
		conns = append(conns, c)
	}
	if err := rows.Err(); err != nil {
		return "", nil, nil, nil, err
	}
	var runs []inventory.Run
	rows, err = tx.Query(ctx, `SELECT c.name, r.label, r.system, r.file, r.status, r.started_at, r.completed_at
		FROM runs r JOIN connections c ON c.id = r.connection_id ORDER BY r.id`)
	if err != nil {
		return "", nil, nil, nil, err
	}
	for rows.Next() {
		var r inventory.Run
		if err := rows.Scan(&r.Connection, &r.Label, &r.System, &r.File, &r.Status, &r.StartedAt, &r.CompletedAt); err != nil {
			return "", nil, nil, nil, err
		}
		r.StartedAt, r.CompletedAt = r.StartedAt.UTC(), r.CompletedAt.UTC()
		runs = append(runs, r)
	}
	if err := rows.Err(); err != nil {
		return "", nil, nil, nil, err
	}
	var obs []inventory.Observation
	rows, err = tx.Query(ctx, `SELECT c.name, o.collection, o.external_id, o.schema_version, o.attrs::text, o.observed_at
		FROM observations o JOIN connections c ON c.id = o.connection_id
		ORDER BY c.id, o.collection, o.external_id`)
	if err != nil {
		return "", nil, nil, nil, err
	}
	for rows.Next() {
		var o inventory.Observation
		var attrs string
		var observed time.Time
		if err := rows.Scan(&o.Connection, &o.Collection, &o.ExternalID, &o.Schema, &attrs, &observed); err != nil {
			return "", nil, nil, nil, err
		}
		o.Attrs, o.ObservedAt = []byte(attrs), observed.UTC()
		obs = append(obs, o)
	}
	if err := rows.Err(); err != nil {
		return "", nil, nil, nil, err
	}
	return company, conns, runs, obs, tx.Commit(ctx)
}
