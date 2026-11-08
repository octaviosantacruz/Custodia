package inventory_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/octaviosantacruz/Custodia/server/internal/inventory"
	"github.com/octaviosantacruz/Custodia/server/internal/people"
)

const fixturePath = "../../../web/src/demo/model/company.json"

func acmeSnapshot(t *testing.T) people.Snapshot {
	t.Helper()
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	asOf, err := inventory.AcmeAsOf(raw)
	if err != nil {
		t.Fatal(err)
	}
	company, conns, runs, obs, err := inventory.AcmeSeed(raw, 0)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := inventory.Assemble(company, asOf, conns, runs, obs)
	if err != nil {
		t.Fatal(err)
	}
	return snap
}

func normalize(t *testing.T, v any) any {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func golden(t *testing.T, name string) any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", name))
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func same(t *testing.T, name string, got any) {
	t.Helper()
	want, have := golden(t, name), normalize(t, got)
	if !reflect.DeepEqual(want, have) {
		w, _ := json.MarshalIndent(want, "", " ")
		h, _ := json.MarshalIndent(have, "", " ")
		t.Errorf("%s differs from the demo.\nwant: %s\ngot:  %s", name, w, h)
	}
}

// The Go core must say exactly what the demo says for every person of Acme.
func TestParityWithTheDemo(t *testing.T) {
	snap := acmeSnapshot(t)
	same(t, "coverage.json", snap.CoverageSummary())
	same(t, "search-empty.json", snap.Search(""))
	same(t, "search-bob.json", snap.Search("BOB"))
	same(t, "search-acme.json", snap.Search("acme.example"))
	same(t, "person-unknown.json", snap.Summary("nobody@acme.example"))
	for _, p := range snap.People() {
		key := strings.Split(p.Email, "@")[0]
		same(t, "person-"+key+".json", snap.Summary(p.Email))
		same(t, "coverage-"+key+".json", snap.CoverageOf(p))
	}
	if n := len(snap.People()); n != 6 {
		t.Fatalf("people = %d, want 6", n)
	}
}
