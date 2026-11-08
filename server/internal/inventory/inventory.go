// Package inventory is what Custodia stores: runs and the observations each
// run brought, keyed by connection, collection and external ID. Assemble
// turns them into the people.Snapshot the People view reads. It is pure:
// storage and transport live in their adapters.
package inventory

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/octaviosantacruz/Custodia/server/internal/people"
)

// Collections Custodia understands in this version, per source.
const (
	CollectionUsers    = "users"
	CollectionAccounts = "accounts"
	CollectionDevices  = "devices"
)

// Connection is one configured instance of a tool. Two connections of the
// same type never share records, even with equal external IDs.
type Connection struct {
	Name      string // unique, e.g. acme-netskope
	Source    string // people.SourceIdentity, SourcePAM or SourceNetskope
	Synthetic bool
}

// Run is one capture of a connection.
type Run struct {
	Connection  string
	Label       string // run_id shown as evidence
	System      string
	File        string
	Status      string // completed or partial
	StartedAt   time.Time
	CompletedAt time.Time
}

// Observation is one record as a run saw it. Attrs holds only allowlisted
// fields, versioned by Schema.
type Observation struct {
	Connection string
	Collection string
	ExternalID string
	Schema     int
	Attrs      json.RawMessage
	ObservedAt time.Time
}

// Attribute sets, schema 1.
type userAttrs struct {
	ID       int64   `json:"id"`
	SourceID string  `json:"source_id"`
	Email    string  `json:"email"`
	Name     string  `json:"name"`
	Active   *bool   `json:"active,omitempty"`
	SafeIDs  []int64 `json:"safe_ids,omitempty"`
}

type accountAttrs struct {
	SafeID   int64  `json:"safe_id"`
	Platform string `json:"platform"`
}

type deviceAttrs struct {
	ID            int64     `json:"id"`
	UserID        int64     `json:"user_id"`
	OS            string    `json:"os"`
	ClientVersion string    `json:"client_version"`
	LastSignal    time.Time `json:"last_signal_at"`
}

// Assemble builds the snapshot from the latest run of each source. With
// several connections of one source, only the first is read in this version;
// the rest are reported as an error rather than merged silently.
func Assemble(company string, now time.Time, connections []Connection, runs []Run, observations []Observation) (people.Snapshot, error) {
	snap := people.Snapshot{Company: company, Now: now, Runs: map[string]people.Run{}}
	source := map[string]string{}
	seen := map[string]bool{}
	for _, c := range connections {
		if seen[c.Source] {
			return snap, fmt.Errorf("inventory: more than one %s connection is not supported yet", c.Source)
		}
		seen[c.Source] = true
		source[c.Name] = c.Source
	}
	for _, r := range runs {
		s, ok := source[r.Connection]
		if !ok {
			continue
		}
		if current, exists := snap.Runs[s]; exists && !r.CompletedAt.After(current.CompletedAt) {
			continue
		}
		snap.Runs[s] = people.Run{ID: r.Label, System: r.System, File: r.File, Status: r.Status, StartedAt: r.StartedAt, CompletedAt: r.CompletedAt}
	}
	for _, o := range observations {
		s, ok := source[o.Connection]
		if !ok {
			continue
		}
		if o.Schema != 1 {
			return snap, fmt.Errorf("inventory: %s/%s/%s has unknown schema %d", o.Connection, o.Collection, o.ExternalID, o.Schema)
		}
		if err := add(&snap, s, o); err != nil {
			return snap, fmt.Errorf("inventory: %s/%s/%s: %w", o.Connection, o.Collection, o.ExternalID, err)
		}
	}
	return snap, nil
}

func add(snap *people.Snapshot, source string, o Observation) error {
	switch {
	case o.Collection == CollectionUsers:
		var u userAttrs
		if err := json.Unmarshal(o.Attrs, &u); err != nil {
			return err
		}
		switch source {
		case people.SourceIdentity:
			active := u.Active == nil || *u.Active
			snap.IdentityUsers = append(snap.IdentityUsers, people.IdentityUser{ID: u.ID, SourceID: u.SourceID, Email: u.Email, Name: u.Name, Active: active})
		case people.SourcePAM:
			snap.PAMUsers = append(snap.PAMUsers, people.PAMUser{ID: u.ID, SourceID: u.SourceID, Email: u.Email, Name: u.Name, SafeIDs: u.SafeIDs})
		case people.SourceNetskope:
			snap.NetskopeUsers = append(snap.NetskopeUsers, people.NetskopeUser{ID: u.ID, SourceID: u.SourceID, Email: u.Email, Name: u.Name})
		}
	case o.Collection == CollectionAccounts && source == people.SourcePAM:
		var a accountAttrs
		if err := json.Unmarshal(o.Attrs, &a); err != nil {
			return err
		}
		snap.Accounts = append(snap.Accounts, people.Account{SafeID: a.SafeID, Platform: a.Platform})
	case o.Collection == CollectionDevices && source == people.SourceNetskope:
		var d deviceAttrs
		if err := json.Unmarshal(o.Attrs, &d); err != nil {
			return err
		}
		snap.Devices = append(snap.Devices, people.Device{ID: d.ID, UserID: d.UserID, OS: d.OS, ClientVersion: d.ClientVersion, LastSignal: d.LastSignal})
	default:
		return fmt.Errorf("collection %q is not read for %s", o.Collection, source)
	}
	return nil
}
