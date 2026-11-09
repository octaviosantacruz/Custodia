// Package people is the pure core of the People view: it resolves people
// from Identity Administration records, links each tool's records to them by
// exact, unique email, and evaluates CONN-001 (Netskope client active and
// observed recently) with its evidence.
//
// It reads a Snapshot and returns the response bodies of /api/chains/person*.
// No HTTP, SQL or clock: Now is part of the input. A link needs exactly one
// candidate; two candidates are "ambiguous" and never a guess.
package people

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Source keys, as runs and observations name them.
const (
	SourceIdentity = "identity"
	SourcePAM      = "pam"
	SourceNetskope = "netskope"
)

// Rule CONN-001 thresholds.
const (
	PersonFreshnessHours = 24
	DeviceFreshnessDays  = 7
)

// Run is one capture of a source.
type Run struct {
	ID          string
	System      string // source_system in evidence, e.g. identity_administration
	File        string // source_file in evidence
	Status      string // completed or partial
	StartedAt   time.Time
	CompletedAt time.Time
}

type IdentityUser struct {
	ID       int64
	SourceID string
	Email    string
	Name     string
	Active   bool
}

type PAMUser struct {
	ID       int64
	SourceID string
	Email    string
	Name     string
	SafeIDs  []int64
}

type Account struct {
	SafeID   int64
	Platform string
}

type NetskopeUser struct {
	ID       int64
	SourceID string
	Email    string
	Name     string
}

type Device struct {
	ID            int64
	UserID        int64 // Netskope user
	OS            string
	ClientVersion string
	LastSignal    time.Time
}

// Snapshot is everything the view reads, as of Now.
type Snapshot struct {
	Company       string
	Now           time.Time
	Runs          map[string]Run
	IdentityUsers []IdentityUser
	PAMUsers      []PAMUser
	Accounts      []Account
	NetskopeUsers []NetskopeUser
	Devices       []Device
}

// Person is a resolved person with the records linked to them.
type Person struct {
	Email    string
	Name     string
	Identity []IdentityUser
	PAM      []PAMUser
	Netskope []NetskopeUser
}

func normEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// People are the distinct emails of active Identity records, in the order of
// their first record.
func (s Snapshot) People() []Person {
	var out []Person
	index := map[string]int{}
	identity := slices.Clone(s.IdentityUsers)
	slices.SortStableFunc(identity, func(a, b IdentityUser) int { return int(a.ID - b.ID) })
	for _, u := range identity {
		email := normEmail(u.Email)
		if !u.Active || email == "" {
			continue
		}
		i, ok := index[email]
		if !ok {
			i = len(out)
			index[email] = i
			out = append(out, Person{Email: email, Name: u.Name})
		}
		out[i].Identity = append(out[i].Identity, u)
	}
	for i := range out {
		for _, u := range s.PAMUsers {
			if normEmail(u.Email) == out[i].Email {
				out[i].PAM = append(out[i].PAM, u)
			}
		}
		for _, u := range s.NetskopeUsers {
			if normEmail(u.Email) == out[i].Email {
				out[i].Netskope = append(out[i].Netskope, u)
			}
		}
	}
	return out
}

// Find returns the person with email.
func (s Snapshot) Find(email string) (Person, bool) {
	email = normEmail(email)
	for _, p := range s.People() {
		if p.Email == email {
			return p, true
		}
	}
	return Person{}, false
}

func (s Snapshot) devicesOf(p Person) []Device {
	if len(p.Netskope) != 1 {
		return nil
	}
	var out []Device
	for _, d := range s.Devices {
		if d.UserID == p.Netskope[0].ID {
			out = append(out, d)
		}
	}
	return out
}

// recent reports a client signal within DeviceFreshnessDays of the capture.
func (s Snapshot) recent(d Device) bool {
	capture := s.Runs[SourceNetskope].CompletedAt
	return capture.Sub(d.LastSignal) <= DeviceFreshnessDays*24*time.Hour
}

// Mode is how far the Netskope capture can be trusted.
type Mode string

const (
	ModeComplete Mode = "complete"
	ModeStale    Mode = "stale"
	ModePartial  Mode = "partial"
)

// NetskopeMode: a partial capture cannot assert absence; one older than
// PersonFreshnessHours cannot assert current coverage.
func (s Snapshot) NetskopeMode() Mode {
	run := s.Runs[SourceNetskope]
	switch {
	case run.Status != "completed":
		return ModePartial
	case s.Now.Sub(run.CompletedAt) > PersonFreshnessHours*time.Hour:
		return ModeStale
	default:
		return ModeComplete
	}
}

// Evidence describes the run a conclusion rests on.
type Evidence struct {
	SourceSystem string `json:"source_system"`
	SourceFile   string `json:"source_file"`
	RunID        string `json:"run_id"`
	Status       string `json:"status"`
	StartedAt    string `json:"started_at"`
	CompletedAt  string `json:"completed_at"`
	Freshness    string `json:"freshness"`
	AgeHours     int64  `json:"age_hours"`
}

func (s Snapshot) evidence(source string) Evidence {
	run := s.Runs[source]
	age := int64(math.Floor(s.Now.Sub(run.CompletedAt).Hours()))
	freshness := "fresh"
	switch {
	case run.Status != "completed":
		freshness = "incomplete"
	case s.Now.Sub(run.CompletedAt) > PersonFreshnessHours*time.Hour:
		freshness = "stale"
	}
	return Evidence{SourceSystem: run.System, SourceFile: run.File, RunID: run.ID, Status: run.Status,
		StartedAt: iso(run.StartedAt), CompletedAt: iso(run.CompletedAt), Freshness: freshness, AgeHours: age}
}

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// Coverage is the CONN-001 answer for one person.
type Coverage struct {
	MetricCode       string              `json:"metric_code"`
	MetricVersion    string              `json:"metric_version"`
	Email            string              `json:"email"`
	Status           string              `json:"status"`
	IdentityRecords  int                 `json:"identity_records"`
	NetskopeUsers    int                 `json:"netskope_users"`
	DevicesRecent    int                 `json:"devices_recent"`
	DevicesNotRecent int                 `json:"devices_not_recent"`
	DevicesTotal     int                 `json:"devices_total"`
	DevicesAmbiguous int                 `json:"devices_ambiguous"`
	Sources          map[string]Evidence `json:"sources"`
	Explanation      string              `json:"explanation"`
}

// Explanations are in Spanish, the interface's source language; the
// frontend translates them like any other text.
const (
	explainAmbiguous = "Hay dos identidades activas con el mismo correo. No se elige una automáticamente."
	explainPartial   = "La captura Netskope es parcial. No permite afirmar ausencia ni cobertura vigente."
	explainGap       = "Identidad y usuario Netskope únicos, captura completa y vigente, pero ningún dispositivo reciente observado."
	explainPartialCv = "Hay un dispositivo reciente y otro sin señal en 7 días. No confirma abandono ni falta de EDR."
	explainCovered   = "Todos los dispositivos vinculados por usuario exacto tienen señal en los últimos 7 días. Sólo demuestra evidencia del cliente Netskope."
	explainNoUser    = "No hay un usuario Netskope único con este correo. No se evalúa cobertura."
)

func (s Snapshot) sources() map[string]Evidence {
	return map[string]Evidence{"identity": s.evidence(SourceIdentity), "netskope": s.evidence(SourceNetskope)}
}

// CoverageOf evaluates CONN-001 for p.
func (s Snapshot) CoverageOf(p Person) Coverage {
	devices := s.devicesOf(p)
	recent := 0
	for _, d := range devices {
		if s.recent(d) {
			recent++
		}
	}
	mode := s.NetskopeMode()
	status, explanation := "", ""
	switch {
	case len(p.Identity) != 1:
		status, explanation = "unknown", explainAmbiguous
	case mode == ModePartial:
		status, explanation = "unknown", explainPartial
	case mode == ModeStale:
		age := int(s.Now.Sub(s.Runs[SourceNetskope].CompletedAt).Hours())
		status, explanation = "unknown", "La captura Netskope tiene "+strconv.Itoa(age)+" horas. Supera el umbral de 24 horas; no se evalúa cobertura."
	case len(p.Netskope) != 1:
		status, explanation = "unknown", explainNoUser
	case recent == 0:
		status, explanation = "gap", explainGap
	case recent < len(devices):
		status, explanation = "partial", explainPartialCv
	default:
		status, explanation = "covered", explainCovered
	}
	return Coverage{MetricCode: "CONN-001", MetricVersion: "1", Email: p.Email, Status: status,
		IdentityRecords: len(p.Identity), NetskopeUsers: len(p.Netskope), DevicesRecent: recent,
		DevicesNotRecent: len(devices) - recent, DevicesTotal: len(devices), Sources: s.sources(), Explanation: explanation}
}

// CoverageSummary is CONN-001 over the whole population.
func (s Snapshot) CoverageSummary() map[string]any {
	people := s.People()
	counts := map[string]any{"denominator": len(people), "covered": 0, "partial": 0, "gap": 0, "unknown": 0,
		"coverage_percent": nil, "devices_total": len(s.Devices), "device_coverage_percent": nil}
	tally := map[string]int{}
	for _, p := range people {
		tally[s.CoverageOf(p).Status]++
	}
	for _, status := range []string{"covered", "partial", "gap", "unknown"} {
		counts[status] = tally[status]
	}
	recent := 0
	for _, d := range s.Devices {
		if s.recent(d) {
			recent++
		}
	}
	counts["devices_recent"] = recent
	if s.NetskopeMode() == ModeComplete && len(people) > 0 && len(s.Devices) > 0 {
		counts["coverage_percent"] = float64(tally["covered"]) / float64(len(people)) * 100
		counts["device_coverage_percent"] = float64(recent) / float64(len(s.Devices)) * 100
	}
	return map[string]any{"metric_code": "CONN-001", "metric_version": "1",
		"label":                  "Cliente Netskope activo y observado recientemente",
		"population":             "Personas activas de " + s.Company + " (Identity Administration)",
		"person_freshness_hours": PersonFreshnessHours, "device_freshness_days": DeviceFreshnessDays,
		"counts": counts, "sources": s.sources()}
}

// SearchResult is one person in a search.
type SearchResult struct {
	Email   string   `json:"email"`
	Name    string   `json:"name"`
	Sources []string `json:"sources"`
}

// Search matches query against name and email, case-insensitively.
func (s Snapshot) Search(query string) map[string]any {
	needle := strings.ToLower(strings.TrimSpace(query))
	results := []SearchResult{}
	for _, p := range s.People() {
		if needle != "" && !strings.Contains(strings.ToLower(p.Name+" "+p.Email), needle) {
			continue
		}
		var sources []string
		if len(p.PAM) > 0 {
			sources = append(sources, SourcePAM)
		}
		sources = append(sources, SourceIdentity)
		if len(p.Netskope) > 0 {
			sources = append(sources, SourceNetskope)
		}
		results = append(results, SearchResult{Email: p.Email, Name: p.Name, Sources: sources})
	}
	return map[string]any{"query": query, "people": results}
}

// Summary is /api/chains/person: how the person is linked in each tool.
func (s Snapshot) Summary(email string) map[string]any {
	p, ok := s.Find(email)
	if !ok {
		return map[string]any{"email": email, "name": "", "tools": map[string]any{}}
	}
	tools := map[string]any{"pam": s.pamSummary(p), "identity": identitySummary(p), "netskope": s.netskopeSummary(p)}
	return map[string]any{"email": p.Email, "name": p.Name, "tools": tools}
}

func (s Snapshot) pamSummary(p Person) map[string]any {
	switch len(p.PAM) {
	case 0:
		return map[string]any{"status": "unmatched"}
	case 1:
	default:
		return map[string]any{"status": "ambiguous", "basis": "multiple_active_candidates"}
	}
	u := p.PAM[0]
	accounts, platforms := 0, map[string]bool{}
	for _, a := range s.Accounts {
		if slices.Contains(u.SafeIDs, a.SafeID) {
			accounts++
			platforms[a.Platform] = true
		}
	}
	return map[string]any{"status": "matched", "basis": "email_exact",
		"user":   map[string]any{"object_id": u.ID, "display_name": u.Name, "source_id": u.SourceID, "user_type": "EPVUser"},
		"totals": map[string]any{"roles": 1, "safes": len(u.SafeIDs), "accounts": accounts, "platforms": len(platforms), "psms": 0}}
}

func identitySummary(p Person) map[string]any {
	if len(p.Identity) != 1 {
		return map[string]any{"status": "ambiguous", "basis": "multiple_active_candidates"}
	}
	u := p.Identity[0]
	roles := 0
	if len(p.PAM) > 0 {
		roles = 1
	}
	return map[string]any{"status": "matched", "basis": "email_exact",
		"user":       map[string]any{"object_id": u.ID, "display_name": u.Name, "source_id": u.SourceID, "active": true},
		"role_count": roles}
}

func (s Snapshot) netskopeSummary(p Person) map[string]any {
	switch len(p.Netskope) {
	case 0:
		return map[string]any{"status": "unmatched"}
	case 1:
	default:
		return map[string]any{"status": "ambiguous", "basis": "multiple_active_candidates"}
	}
	u := p.Netskope[0]
	devices := s.devicesOf(p)
	recent, versions, systems := 0, []string{}, []string{}
	for _, d := range devices {
		if s.recent(d) {
			recent++
		}
		if !slices.Contains(versions, d.ClientVersion) {
			versions = append(versions, d.ClientVersion)
		}
		if !slices.Contains(systems, d.OS) {
			systems = append(systems, d.OS)
		}
	}
	return map[string]any{"status": "matched", "basis": "email_exact",
		"user":         map[string]any{"object_id": u.ID, "display_name": u.Name, "source_id": u.SourceID},
		"device_count": recent, "stale_device_count": len(devices) - recent, "company": s.Company,
		"client_versions": versions, "operating_systems": systems}
}
