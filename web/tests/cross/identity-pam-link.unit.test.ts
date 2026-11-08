import assert from 'node:assert/strict';
import test from 'node:test';

import { IDENTITY_PAM_CHAIN_BASIS, identityPamLinkView } from '../../src/cross/lib/identity-pam-link.ts';
import type { IdentityPamChain } from '../../src/cyberark/pam/types/pam.ts';

function chain(overrides: Partial<IdentityPamChain>): IdentityPamChain {
  return {
    matched: false,
    pam_user: null,
    roles: [],
    roles_omitted: 0,
    totals: { roles: 0, safes: 0, platforms: 0, psms: 0, accounts: 0 },
    ...overrides,
  };
}

test('UUID-linked chains keep the verified UUID label', () => {
  const view = identityPamLinkView(chain({ matched: true, match_basis: 'uuid', status: 'matched' }));
  assert.equal(view.statusLabel, 'UUID verificado');
  assert.equal(view.originDescription, 'UUID de Identity coincidente');
  assert.equal(view.tone, 'success');
});

test('legacy matched payloads without match_basis keep the UUID label', () => {
  const view = identityPamLinkView(chain({ matched: true }));
  assert.equal(view.statusLabel, 'UUID verificado');
});

test('email-linked chains are labelled as vinculado por correo, never UUID', () => {
  const view = identityPamLinkView(chain({ matched: true, match_basis: 'email', status: 'matched' }));
  assert.equal(view.statusLabel, 'Vinculado por correo');
  assert.equal(view.originDescription, 'Correo exacto coincidente');
  assert.match(view.heading, /correo exacto 1 a 1/);
  assert.doesNotMatch(view.statusLabel, /UUID/);
});

test('ambiguous email links are explained instead of claiming no UUID match', () => {
  const view = identityPamLinkView(chain({ match_basis: 'email', status: 'ambiguous' }));
  assert.equal(view.statusLabel, 'Vínculo ambiguo');
  assert.equal(view.tone, 'warning');
  assert.match(view.emptyCopy, /más de un usuario/);
});

test('unmatched chains explain both sanctioned bases', () => {
  const view = identityPamLinkView(chain({ match_basis: null, status: 'unmatched' }));
  assert.equal(view.statusLabel, 'Sin vínculo');
  assert.match(view.emptyCopy, /UUID de CyberArk Identity ni un correo exacto/);
});

test('a missing chain is treated as unmatched, never as verified', () => {
  const view = identityPamLinkView(null);
  assert.equal(view.tone, 'neutral');
  assert.equal(view.statusLabel, 'Sin vínculo');
});

test('the chain basis copy reuses the exact drawer wording for the PAM bridge', () => {
  const uuid = identityPamLinkView(chain({ matched: true, match_basis: 'uuid', status: 'matched' }));
  const email = identityPamLinkView(chain({ matched: true, match_basis: 'email', status: 'matched' }));
  assert.equal(IDENTITY_PAM_CHAIN_BASIS.uuid_exact, uuid.heading);
  assert.equal(IDENTITY_PAM_CHAIN_BASIS.email_exact, email.heading);
  assert.match(IDENTITY_PAM_CHAIN_BASIS.uuid_exact, /UUID de CyberArk Identity/);
  assert.match(IDENTITY_PAM_CHAIN_BASIS.email_exact, /correo exacto 1 a 1/);
  assert.doesNotMatch(IDENTITY_PAM_CHAIN_BASIS.email_exact, /UUID verificado/);
});
