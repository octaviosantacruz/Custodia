package inventory

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/octaviosantacruz/Custodia/server/internal/people"
)

// AcmeFixture is web/src/demo/model/company.json, the fictional company the
// demo and the site use. Only the fields the People view reads are decoded.
type AcmeFixture struct {
	Company struct {
		Name       string    `json:"name"`
		AsOf       time.Time `json:"asOf"`
		CapturedAt time.Time `json:"capturedAt"`
		Fictional  bool      `json:"fictional"`
	} `json:"company"`
	People []struct {
		ID          int64   `json:"id"`
		Name        string  `json:"name"`
		Email       string  `json:"email"`
		IdentityIDs []int64 `json:"identityIds"`
		NetskopeID  int64   `json:"netskopeId"`
		PAMID       *int64  `json:"pamId"`
		SafeIDs     []int64 `json:"safeIds"`
	} `json:"people"`
	Devices []struct {
		ID            int64     `json:"id"`
		PersonID      int64     `json:"personId"`
		OS            string    `json:"os"`
		ClientVersion string    `json:"clientVersion"`
		LastSignalAt  time.Time `json:"lastSignalAt"`
	} `json:"devices"`
	Accounts []struct {
		ID       string `json:"id"`
		SafeID   int64  `json:"safeId"`
		Platform string `json:"platform"`
	} `json:"accounts"`
}

// Acme connection names.
const (
	AcmeIdentity = "acme-identity"
	AcmePAM      = "acme-pam"
	AcmeNetskope = "acme-netskope"
)

// AcmeSeed turns the fixture into synthetic connections, runs and
// observations. Every timestamp moves by shift, so a seed made now can read
// as captured an hour ago (shift = now - asOf); a zero shift keeps the
// fixture's own dates. It refuses a fixture that is not marked fictional.
func AcmeSeed(raw []byte, shift time.Duration) (string, []Connection, []Run, []Observation, error) {
	var f AcmeFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		return "", nil, nil, nil, fmt.Errorf("acme fixture: %w", err)
	}
	if !f.Company.Fictional {
		return "", nil, nil, nil, fmt.Errorf("acme fixture: refusing a company not marked fictional")
	}
	at := func(t time.Time) time.Time { return t.Add(shift).UTC() }
	captured := at(f.Company.CapturedAt)
	connections := []Connection{
		{Name: AcmeIdentity, Source: people.SourceIdentity, Synthetic: true},
		{Name: AcmePAM, Source: people.SourcePAM, Synthetic: true},
		{Name: AcmeNetskope, Source: people.SourceNetskope, Synthetic: true},
	}
	run := func(connection, system string) Run {
		return Run{Connection: connection, Label: "acme-" + system + "-complete", System: system, File: "fictional-" + system,
			Status: "completed", StartedAt: captured.Add(-2 * time.Minute), CompletedAt: captured}
	}
	runs := []Run{run(AcmeIdentity, "identity_administration"), run(AcmePAM, "pam"), run(AcmeNetskope, "netskope")}

	var obs []Observation
	put := func(connection, collection, id string, attrs any) error {
		data, err := json.Marshal(attrs)
		if err != nil {
			return err
		}
		obs = append(obs, Observation{Connection: connection, Collection: collection, ExternalID: id, Schema: 1, Attrs: data, ObservedAt: captured})
		return nil
	}
	netskopeUser := map[int64]int64{}
	for _, p := range f.People {
		for _, id := range p.IdentityIDs {
			active := true
			if err := put(AcmeIdentity, CollectionUsers, strconv.FormatInt(id, 10), userAttrs{ID: id, SourceID: "acme-identity-" + strconv.FormatInt(id, 10), Email: p.Email, Name: p.Name, Active: &active}); err != nil {
				return "", nil, nil, nil, err
			}
		}
		if p.PAMID != nil {
			if err := put(AcmePAM, CollectionUsers, strconv.FormatInt(*p.PAMID, 10), userAttrs{ID: *p.PAMID, SourceID: "acme-pam-" + strconv.FormatInt(p.ID, 10), Email: p.Email, Name: p.Name, SafeIDs: p.SafeIDs}); err != nil {
				return "", nil, nil, nil, err
			}
		}
		if err := put(AcmeNetskope, CollectionUsers, strconv.FormatInt(p.NetskopeID, 10), userAttrs{ID: p.NetskopeID, SourceID: "acme-netskope-" + strconv.FormatInt(p.ID, 10), Email: p.Email, Name: p.Name}); err != nil {
			return "", nil, nil, nil, err
		}
		netskopeUser[p.ID] = p.NetskopeID
	}
	for _, a := range f.Accounts {
		if err := put(AcmePAM, CollectionAccounts, a.ID, accountAttrs{SafeID: a.SafeID, Platform: a.Platform}); err != nil {
			return "", nil, nil, nil, err
		}
	}
	for _, d := range f.Devices {
		if err := put(AcmeNetskope, CollectionDevices, strconv.FormatInt(d.ID, 10), deviceAttrs{ID: d.ID, UserID: netskopeUser[d.PersonID], OS: d.OS, ClientVersion: d.ClientVersion, LastSignal: at(d.LastSignalAt)}); err != nil {
			return "", nil, nil, nil, err
		}
	}
	return f.Company.Name, connections, runs, obs, nil
}

// AcmeAsOf is the fixture's reference time, at which the demo is evaluated.
func AcmeAsOf(raw []byte) (time.Time, error) {
	var f AcmeFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		return time.Time{}, err
	}
	return f.Company.AsOf, nil
}
