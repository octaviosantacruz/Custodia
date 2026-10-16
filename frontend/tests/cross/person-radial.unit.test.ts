import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERSON_CENTER,
  PERSON_STAGE,
  PERSON_TOPOLOGY_ORDER,
  defaultPersonTool,
  factPositions,
  personEdge,
  personLinkStyle,
  personPlatformAnswer,
  personPlatformSources,
  personToolFacts,
  personToolHeadline,
  siaAccessDetail,
  siaPolicyCount,
  stagePercent,
  toolPosition,
  topologyChildren,
  topologyNode,
} from '../../src/cross/lib/person-radial.ts';
import type { PersonToolSummary } from '../../src/cross/lib/chains-api.ts';

const pam: PersonToolSummary = {
  status: 'matched',
  user: { object_id: 8, display_name: 'Ada', source_id: 'ada@example.com' },
  totals: { roles: 1, safes: 12, platforms: 3, psms: 1, accounts: 30 },
};

test('the topology keeps only CyberArk and Netskope as person-map platforms', () => {
  assert.deepEqual(PERSON_TOPOLOGY_ORDER, ['pam', 'netskope']);
  assert.deepEqual(topologyChildren('pam'), []);
  assert.deepEqual(topologyChildren('netskope'), []);
  assert.equal(topologyNode('pam').depth, 0);
  assert.equal(topologyNode('netskope').depth, 0);
  assert.equal(topologyNode('pam').parent, null);
  assert.equal(topologyNode('netskope').parent, null);
});

test('platform positions are deterministic and stay on opposite sides', () => {
  assert.deepEqual(PERSON_STAGE, { width: 160, height: 120 });
  assert.deepEqual(toolPosition('pam'), { x: 116, y: 60 });
  assert.deepEqual(toolPosition('netskope'), { x: 44, y: 60 });
  assert.deepEqual(stagePercent(PERSON_CENTER), { left: '50%', top: '50%' });
  assert.deepEqual(stagePercent(toolPosition('pam')), { left: '72.5%', top: '50%' });
});

test('every edge leaves the person for its platform', () => {
  assert.deepEqual(personEdge('pam'), { from: PERSON_CENTER, to: { x: 116, y: 60 } });
  assert.deepEqual(personEdge('netskope'), { from: PERSON_CENTER, to: { x: 44, y: 60 } });
});

test('facts sit on the branch outer side and inside the stage', () => {
  const pamFacts = factPositions('pam', 5);
  assert.ok(pamFacts.every((point) => point.x > toolPosition('pam').x));
  assert.deepEqual(pamFacts.map((point) => point.x), [142, 142, 142, 142, 142]);
  assert.deepEqual(pamFacts.map((point) => point.y), [40, 50, 60, 70, 80]);
  const netskopeFacts = factPositions('netskope', 5);
  assert.ok(netskopeFacts.every((point) => point.x < toolPosition('netskope').x));
  assert.deepEqual(netskopeFacts.map((point) => point.x), [18, 18, 18, 18, 18]);
  for (const source of PERSON_TOPOLOGY_ORDER) {
    for (const point of factPositions(source, 5)) {
      assert.ok(point.x > 0 && point.x < PERSON_STAGE.width && point.y > 0 && point.y < PERSON_STAGE.height, `${source} fact inside the stage`);
    }
  }
});

test('the spoke only exists for a person the tool actually has', () => {
  assert.equal(personLinkStyle(pam), 'linked');
  assert.equal(personLinkStyle({ status: 'reference', policy_count: 1 }), 'reference');
  assert.equal(personLinkStyle({ status: 'ambiguous' }), 'ambiguous');
  assert.equal(personLinkStyle({ status: 'unmatched' }), 'none');
  assert.equal(personLinkStyle(undefined), 'none');
});

test('platform headline and facts come from their own summary without inventing data', () => {
  assert.equal(personToolHeadline('pam', pam), '12 Safes');
  assert.equal(personToolHeadline('netskope', { status: 'matched', device_count: 1 }), '1 dispositivo');
  assert.deepEqual(personToolFacts('pam', pam).map((fact) => `${fact.label}=${fact.value}`), ['Roles=1', 'Safes=12', 'Plataformas=3', 'PSM=1', 'Cuentas=30']);
  assert.deepEqual(personToolFacts('netskope', { status: 'matched', device_count: 2 }), [{ label: 'Recientes · 7 días', value: '2' }]);
  // A stale device is shown apart, never folded into the recent count.
  assert.deepEqual(personToolFacts('netskope', { status: 'matched', device_count: 2, stale_device_count: 1 }).map((fact) => `${fact.label}=${fact.value}`), ['Recientes · 7 días=2', 'Sin actividad=1']);
  assert.deepEqual(personToolFacts('pam', { status: 'ambiguous' }), []);
});

test('the map opens on the first linked platform', () => {
  assert.equal(defaultPersonTool([
    { source: 'netskope', tool: { status: 'matched' } },
  ]), 'netskope');
  assert.equal(defaultPersonTool([{ source: 'pam', tool: { status: 'reference' } }]), 'pam');
  assert.equal(defaultPersonTool([]), null);
});

test('CONN-SPACE-001 each platform answers yes or no with one count, and a missing permission is never a no', () => {
  const answer = (source: 'pam' | 'netskope', tool: Parameters<typeof personPlatformAnswer>[1]) => {
    const result = personPlatformAnswer(source, tool);
    return [result.answer, result.label, result.count];
  };
  assert.deepEqual(answer('pam', pam), ['yes', 'Con acceso privilegiado', '12 Safes']);
  assert.deepEqual(answer('pam', { status: 'matched', totals: { roles: 1, safes: 0, platforms: 0, psms: 0, accounts: 0 } }), ['no', 'Usuario sin Safes', null]);
  assert.deepEqual(answer('pam', { status: 'matched', user: { object_id: 1, display_name: 'A', source_id: 'a', suspended: true }, totals: { roles: 1, safes: 1, platforms: 1, psms: 1, accounts: 1 } }), ['yes', 'Usuario suspendido', '1 Safe']);
  assert.deepEqual(answer('pam', { status: 'unmatched' }), ['no', 'Sin acceso registrado', null]);
  assert.deepEqual(answer('pam', { status: 'reference' }), ['reference', 'Referencia por nombre', null]);
  assert.deepEqual(answer('netskope', { status: 'matched', device_count: 2 }), ['yes', 'Cliente activo', '2 equipos recientes']);
  assert.deepEqual(answer('netskope', { status: 'matched', device_count: 0, stale_device_count: 1 }), ['no', 'Cliente sin actividad reciente', '1 equipo']);
  assert.deepEqual(answer('netskope', { status: 'matched', device_count: 0 }), ['no', 'Sin equipos', null]);
  assert.deepEqual(answer('netskope', { status: 'unmatched' }), ['no', 'Sin cliente registrado', null]);
  assert.deepEqual(answer('netskope', { status: 'ambiguous' }), ['ambiguous', 'Vínculo ambiguo', null]);
  // The backend omits a tool the actor cannot read: that is unknown, not "no".
  assert.deepEqual(answer('netskope', undefined), ['unknown', 'Sin permiso de lectura', null]);
});

test('CONN-SPACE-001 search results name platforms, folding Identity and SIA into CyberArk', () => {
  assert.deepEqual(personPlatformSources(['pam', 'identity', 'netskope']), ['CyberArk', 'Netskope']);
  assert.deepEqual(personPlatformSources(['identity']), ['CyberArk']);
  assert.deepEqual(personPlatformSources(['sia', 'pam']), ['CyberArk']);
  assert.deepEqual(personPlatformSources(['netskope']), ['Netskope']);
  assert.deepEqual(personPlatformSources([]), []);
});

test('CONN-SPACE-001 a person without a PAM user reaches CyberArk through an Identity role, as a name reference', () => {
  const viaRole = { status: 'unmatched' as const, role_access: { basis: 'role_name_exact', matched_roles: 2, ambiguous_roles: 1, safes: 7 } };
  assert.deepEqual(Object.values(personPlatformAnswer('pam', viaRole)).slice(0, 3), ['yes', 'Con acceso por rol', '7 Safes']);
  assert.equal(personLinkStyle(viaRole), 'reference');
  assert.deepEqual(personToolFacts('pam', viaRole).map((fact) => `${fact.label}=${fact.value}`), ['Roles vinculados=2', 'Safes por rol=7', 'Roles ambiguos=1']);
  // A linked role that reaches no Safe is still no access, with its evidence in the panel.
  const noSafes = { status: 'unmatched' as const, role_access: { basis: 'role_name_exact', matched_roles: 1, ambiguous_roles: 0, safes: 0 } };
  assert.equal(personPlatformAnswer('pam', noSafes).label, 'Sin acceso registrado');
  assert.equal(personLinkStyle(noSafes), 'none');
  assert.deepEqual(personToolFacts('pam', noSafes).map((fact) => `${fact.label}=${fact.value}`), ['Roles vinculados=1', 'Safes por rol=0']);
  // Netskope never uses role access.
  assert.equal(personPlatformAnswer('netskope', { status: 'unmatched' }).answer, 'no');
});

test('CONN-SPACE-001 SIA policies count as CyberArk access, by user or by Identity role, as a name reference', () => {
  const sia = (user: number, role: number, total: number): PersonToolSummary => ({
    status: 'reference',
    policy_count: total,
    sia_access: { basis: 'grantee_name_exact', user_policies: user, role_policies: role, policies: total, matched_roles: role ? 1 : 0, ambiguous_roles: 0 },
  });
  const both = sia(1, 2, 2);
  assert.equal(siaPolicyCount(both), 2);
  assert.equal(siaAccessDetail(both), '1 por usuario · 2 por rol de Identity');
  // With its own Safes, SIA adds to the same count.
  assert.deepEqual(Object.values(personPlatformAnswer('pam', pam, both)).slice(0, 3), ['yes', 'Con acceso privilegiado', '12 Safes · 2 políticas SIA']);
  // Without a PAM user, SIA alone answers yes, drawn as a name reference.
  const noPam = { status: 'unmatched' as const };
  assert.deepEqual(Object.values(personPlatformAnswer('pam', noPam, sia(0, 1, 1))).slice(0, 3), ['yes', 'Acceso por SIA', '1 política SIA']);
  assert.equal(personLinkStyle(noPam, sia(0, 1, 1)), 'reference');
  // A PAM user without Safes but with SIA still has access.
  const noSafes = { ...pam, totals: { ...pam.totals!, safes: 0 } };
  assert.equal(personPlatformAnswer('pam', noSafes, sia(1, 0, 1)).label, 'Acceso por SIA');
  // Safes by role and SIA add up.
  const viaRole = { status: 'unmatched' as const, role_access: { basis: 'role_name_exact', matched_roles: 1, ambiguous_roles: 0, safes: 3 } };
  assert.equal(personPlatformAnswer('pam', viaRole, both).count, '3 Safes · 2 políticas SIA');
  // Zero policies, or no SIA permission, change nothing.
  assert.equal(personPlatformAnswer('pam', noPam, sia(0, 0, 0)).label, 'Sin acceso registrado');
  assert.equal(personLinkStyle(noPam, undefined), 'none');
  // Netskope never reads SIA.
  assert.equal(personPlatformAnswer('netskope', { status: 'unmatched' }, both).answer, 'no');
});
