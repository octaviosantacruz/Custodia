package postgres

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/octaviosantacruz/Custodia/server/internal/inventory"
)

// These tests need a disposable PostgreSQL (scripts/test-db.sh). They never
// run against a database that is not explicitly handed to them.
func testURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("CUSTODIA_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set CUSTODIA_TEST_DATABASE_URL to a disposable database (scripts/test-db.sh)")
	}
	return url
}

func freshStore(t *testing.T) (*Store, string) {
	t.Helper()
	url := testURL(t)
	ctx := context.Background()
	s, err := Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if _, err := s.pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	return s, url
}

func TestMigrateSeedAndLoad(t *testing.T) {
	s, url := freshStore(t)
	ctx := context.Background()
	if pending, err := Pending(ctx, url); err != nil || pending != 0 {
		t.Fatalf("pending = %d, %v", pending, err)
	}
	raw, err := os.ReadFile("../../../../web/src/demo/model/company.json")
	if err != nil {
		t.Fatal(err)
	}
	company, conns, runs, obs, err := inventory.AcmeSeed(raw, 0)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // the same seed twice changes nothing
		if err := s.Seed(ctx, company, conns, runs, obs); err != nil {
			t.Fatal(err)
		}
	}
	gotCompany, gotConns, gotRuns, gotObs, err := s.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if gotCompany != "Acme Corp" || len(gotConns) != 3 || len(gotRuns) != 3 || len(gotObs) != len(obs) {
		t.Fatalf("loaded %q, %d connections, %d runs, %d observations (seeded %d)", gotCompany, len(gotConns), len(gotRuns), len(gotObs), len(obs))
	}
	asOf, _ := inventory.AcmeAsOf(raw)
	snap, err := inventory.Assemble(gotCompany, asOf, gotConns, gotRuns, gotObs)
	if err != nil {
		t.Fatal(err)
	}
	if people := snap.People(); len(people) != 6 {
		t.Fatalf("people from the database = %d", len(people))
	}
}

// Two connections of the same tool may report the same external ID; they
// stay two records.
func TestEqualExternalIDsFromTwoConnectionsStayApart(t *testing.T) {
	s, _ := freshStore(t)
	ctx := context.Background()
	at := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	conns := []inventory.Connection{{Name: "tenant-a", Source: "netskope"}, {Name: "tenant-b", Source: "netskope"}}
	runs := []inventory.Run{
		{Connection: "tenant-a", Label: "a1", System: "netskope", File: "a", Status: "completed", StartedAt: at, CompletedAt: at},
		{Connection: "tenant-b", Label: "b1", System: "netskope", File: "b", Status: "completed", StartedAt: at, CompletedAt: at},
	}
	attrs := func(email string) json.RawMessage {
		b, _ := json.Marshal(map[string]any{"id": 7, "email": email})
		return b
	}
	obs := []inventory.Observation{
		{Connection: "tenant-a", Collection: "users", ExternalID: "7", Schema: 1, Attrs: attrs("a@example.com"), ObservedAt: at},
		{Connection: "tenant-b", Collection: "users", ExternalID: "7", Schema: 1, Attrs: attrs("b@example.com"), ObservedAt: at},
	}
	if err := s.Seed(ctx, "Example", conns, runs, obs); err != nil {
		t.Fatal(err)
	}
	_, _, _, got, err := s.Load(ctx)
	if err != nil || len(got) != 2 || string(got[0].Attrs) == string(got[1].Attrs) {
		t.Fatalf("observations = %+v, %v", got, err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO observations (connection_id, collection, external_id, schema_version, attrs, observed_at, run_id)
		SELECT connection_id, 'users', '', 1, '{}', now(), run_id FROM observations LIMIT 1`); err == nil {
		t.Fatal("accepted an empty external ID")
	}
}
