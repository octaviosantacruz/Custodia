import assert from 'node:assert/strict';
import test from 'node:test';

import { PERSON_TOOL_ORDER, personToolLink, personToolView } from '../../src/cross/lib/person-node-view.ts';
import type { PersonToolSummary } from '../../src/cross/lib/chains-api.ts';

test('matched PAM node shows its totals and opens the PAM chain deep link', () => {
  const tool: PersonToolSummary = {
    status: 'matched',
    basis: 'email_exact',
    user: { object_id: 9, display_name: 'Ada', source_id: 'ada@example.com', user_type: 'EPVUser' },
    totals: { roles: 3, safes: 5, platforms: 4, psms: 2, accounts: 10 },
  };
  const view = personToolView('pam', tool);
  assert.equal(view.tone, 'success');
  assert.equal(view.statusLabel, 'Vinculado por correo');
  assert.match(view.summary, /3 roles · 5 Safes · 10 cuentas/);
  assert.equal(view.openable, true);
  assert.deepEqual(personToolLink('pam', tool), {
    view: 'graph', path: '/pam/graph?type=user&id=9&dir=forward',
  });
});

test('suspended PAM users are labelled without hiding the link', () => {
  const view = personToolView('pam', {
    status: 'matched',
    user: { object_id: 9, display_name: 'Ada', source_id: 'ada@example.com', suspended: true },
  });
  assert.equal(view.statusLabel, 'Vinculado · suspendido');
  assert.equal(view.openable, true);
});

test('ambiguous nodes warn and never open', () => {
  const tool: PersonToolSummary = { status: 'ambiguous' };
  const view = personToolView('identity', tool);
  assert.equal(view.tone, 'warning');
  assert.equal(view.statusLabel, 'Vínculo ambiguo');
  assert.equal(view.openable, false);
  assert.equal(personToolLink('identity', tool), null);
});

test('unmatched nodes stay neutral without inventing data', () => {
  const view = personToolView('netskope', { status: 'unmatched' });
  assert.equal(view.tone, 'neutral');
  assert.equal(view.statusLabel, 'Sin registro');
  assert.equal(view.summary, 'No hay registro de esta persona en la herramienta.');
});

test('SIA reference is labelled by name and never openable', () => {
  const tool: PersonToolSummary = { status: 'reference', basis: 'display_name_reference_only', policy_count: 2 };
  const view = personToolView('sia', tool);
  assert.equal(view.tone, 'info');
  assert.equal(view.statusLabel, 'Referencia por nombre');
  assert.match(view.summary, /2 políticas/);
  assert.match(view.why, /no confirmada/);
  assert.equal(personToolLink('sia', tool), null);
});

test('identity and Netskope matched nodes deep link to their own tools', () => {
  const identity: PersonToolSummary = {
    status: 'matched',
    user: { object_id: 12, display_name: 'Ada', source_id: 'uuid-1', active: true },
    role_count: 4,
    federation: { object_id: 63, display_name: 'Okta Acme', source_id: 'fed-1' },
  };
  assert.match(personToolView('identity', identity).summary, /4 roles · federación Okta Acme/);
  // Identity and PAM are one node in Relaciones: the PAM tool opens it.
  assert.equal(personToolLink('identity', identity), null);
  assert.equal(personToolView('identity', identity).openable, false);

  const netskope: PersonToolSummary = {
    status: 'matched',
    user: { object_id: 3, display_name: 'Ada', source_id: 'u-3' },
    device_count: 42,
    company: 'Acme',
    client_versions: ['110.0.1'],
    operating_systems: ['Windows'],
  };
  assert.match(personToolView('netskope', netskope).summary, /42 dispositivos recientes · Acme/);
  assert.deepEqual(personToolLink('netskope', netskope), {
    view: 'netskopeInventory', path: '/netskope/inventory?observed_user_id=3&freshness=all',
  });
});

test('the tool order is fixed and complete', () => {
  assert.deepEqual([...PERSON_TOOL_ORDER], ['pam', 'identity', 'sia', 'netskope']);
});
