package people

import (
	"strings"
	"testing"
	"time"
)

var capture = time.Date(2026, 10, 22, 13, 0, 0, 0, time.UTC)

func base() Snapshot {
	run := func(system string) Run {
		return Run{ID: "r-" + system, System: system, File: "f", Status: "completed", StartedAt: capture.Add(-time.Minute), CompletedAt: capture}
	}
	return Snapshot{
		Company: "Example", Now: capture.Add(time.Hour),
		Runs:          map[string]Run{SourceIdentity: run("identity_administration"), SourceNetskope: run("netskope"), SourcePAM: run("pam")},
		IdentityUsers: []IdentityUser{{ID: 1, Email: "Ana@Example.com ", Name: "Ana", Active: true}, {ID: 2, Email: "old@example.com", Name: "Old", Active: false}},
		NetskopeUsers: []NetskopeUser{{ID: 10, Email: "ana@example.com", Name: "Ana"}},
		Devices: []Device{
			{ID: 100, UserID: 10, OS: "macOS", ClientVersion: "1", LastSignal: capture.Add(-time.Hour)},
			{ID: 101, UserID: 10, OS: "macOS", ClientVersion: "1", LastSignal: capture.Add(-8 * 24 * time.Hour)},
		},
	}
}

func status(s Snapshot) string {
	p, _ := s.Find("ana@example.com")
	return s.CoverageOf(p).Status
}

func TestCoverageVerdicts(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Snapshot)
		want   string
	}{
		{"one recent, one silent", func(*Snapshot) {}, "partial"},
		{"all recent", func(s *Snapshot) { s.Devices = s.Devices[:1] }, "covered"},
		{"none recent", func(s *Snapshot) { s.Devices = s.Devices[1:] }, "gap"},
		{"no devices at all is a gap, not covered", func(s *Snapshot) { s.Devices = nil }, "gap"},
		{"partial capture cannot assert", func(s *Snapshot) { r := s.Runs[SourceNetskope]; r.Status = "partial"; s.Runs[SourceNetskope] = r }, "unknown"},
		{"stale capture cannot assert", func(s *Snapshot) { s.Now = capture.Add(25 * time.Hour) }, "unknown"},
		{"two identities never guessed", func(s *Snapshot) {
			s.IdentityUsers = append(s.IdentityUsers, IdentityUser{ID: 3, Email: "ana@example.com", Name: "Ana B", Active: true})
		}, "unknown"},
		{"no Netskope user", func(s *Snapshot) { s.NetskopeUsers = nil }, "unknown"},
		{"two Netskope users never guessed", func(s *Snapshot) {
			s.NetskopeUsers = append(s.NetskopeUsers, NetskopeUser{ID: 11, Email: "ana@example.com"})
		}, "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := base()
			s.Runs = map[string]Run{SourceIdentity: s.Runs[SourceIdentity], SourceNetskope: s.Runs[SourceNetskope], SourcePAM: s.Runs[SourcePAM]}
			tc.mutate(&s)
			if got := status(s); got != tc.want {
				t.Fatalf("status = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestPeopleAreActiveIdentitiesByNormalizedEmail(t *testing.T) {
	s := base()
	people := s.People()
	if len(people) != 1 || people[0].Email != "ana@example.com" {
		t.Fatalf("people = %+v", people)
	}
	if _, ok := s.Find("OLD@example.com"); ok {
		t.Fatal("an inactive identity became a person")
	}
	stale := base()
	stale.Now = capture.Add(30 * time.Hour)
	p, _ := stale.Find("ana@example.com")
	if c := stale.CoverageOf(p); !strings.Contains(c.Explanation, "30 horas") || c.Sources["netskope"].Freshness != "stale" {
		t.Fatalf("stale coverage = %+v", c)
	}
	if summary := stale.CoverageSummary(); summary["counts"].(map[string]any)["coverage_percent"] != nil {
		t.Fatal("a percentage was claimed from a stale capture")
	}
}

func TestAmbiguousToolRecordsAreNotLinked(t *testing.T) {
	s := base()
	s.PAMUsers = []PAMUser{{ID: 1, Email: "ana@example.com"}, {ID: 2, Email: "ana@example.com"}}
	tools := s.Summary("ana@example.com")["tools"].(map[string]any)
	if tools["pam"].(map[string]any)["status"] != "ambiguous" {
		t.Fatalf("pam = %+v", tools["pam"])
	}
	if got := s.Summary("nobody@example.com"); got["name"] != "" || len(got["tools"].(map[string]any)) != 0 {
		t.Fatalf("unknown person = %+v", got)
	}
}
