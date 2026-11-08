import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticSyncBatchNotice, automaticSyncNotice, groupSyncRunsByToolCycle, presentNotice, syncSourceForArea, refreshDomainForEvents, refreshDomainForSync, refreshDomainForVisibleWorkspace, refreshKeyForVisibleWorkspace, refreshVisibleWorkspaceForSources, syncSourceFromNotice, syncSourceLabel, syncSourceMeta, syncToolForSource, syncPlanForScope, syncSourcesForScope, syncToolLabel, syncToolMeta, syncToolsForSources } from '../../src/cross/lib/sync-source.ts';
import type { WorkspaceView } from '../../src/cross/lib/workspaces.ts';

test('operational notices resolve the Netskope and CyberArk logos by product', () => {
  const netskope = syncSourceFromNotice('Tu vista de Netskope quedó actualizada');
  const cyberark = syncSourceFromNotice('Tu vista de CyberArk quedó actualizada');

  assert.equal(syncSourceMeta(netskope).image, '/netskope-full-white.png');
  assert.equal(syncSourceMeta(cyberark).image, '/cyberark-logo-mint.png');
});

test('generic notices keep the Custodia fallback instead of assigning a product', () => {
  assert.equal(syncSourceFromNotice('Nombre actualizado.'), null);
});

test('sync labels recover a missing source from the source file', () => {
  assert.equal(syncSourceLabel(undefined, 'netskope-api'), 'Netskope');
  assert.equal(syncSourceLabel(undefined, 'cyberark-api'), 'CyberArk PAM');
  assert.equal(syncSourceLabel(undefined, undefined), 'Sincronización');
});

test('tool labels group CyberArk features while preserving unknown source names', () => {
  for (const source of ['cyberark', 'identity_administration', 'sia', 'access']) {
    assert.equal(syncToolForSource(source), 'cyberark');
  }
  assert.equal(syncToolForSource('netskope'), 'netskope');
  assert.equal(syncToolForSource('future_source'), 'future_source');
  assert.equal(syncToolLabel(syncToolForSource('sia')), 'CyberArk');
  assert.equal(syncToolLabel(syncToolForSource('netskope')), 'Netskope');
  assert.equal(syncToolLabel(syncToolForSource('future_source')), 'future_source');
});

test('tool metadata uses product logos and feature sources produce one chip per tool', () => {
  assert.deepEqual(syncToolMeta('cyberark'), {
    label: 'CyberArk', image: '/cyberark-logo-mint.png', fallback: 'C',
  });
  assert.deepEqual(syncToolMeta('netskope'), {
    label: 'Netskope', image: '/netskope-full-white.png', fallback: 'N',
  });
  assert.deepEqual(syncToolsForSources([
    'cyberark', 'identity_administration', 'sia', 'access', 'cyberark', 'netskope', 'netskope', null,
  ]), ['cyberark', 'netskope']);
});

test('automatic synchronization notices state the result without promising a workspace reload', () => {
  assert.equal(
    automaticSyncNotice({ source_system: 'netskope', status: 'completed', received_object_count: 17891 }),
    'Netskope sincronizó automáticamente 17.891 objetos. Tu vista actual se conserva.',
  );
  assert.match(
    automaticSyncNotice({ source_system: 'cyberark', status: 'failed', error_count: 1 }),
    /con errores\. Tu vista actual se conserva; revisá Actividad/,
  );
  assert.equal(
    automaticSyncNotice({ source_system: 'cyberark', status: 'completed' }),
    'CyberArk terminó una sincronización automática. Tu vista actual se conserva.',
  );
});

test('automatic notices expose a compact title and source-aware detail', () => {
  assert.deepEqual(
    presentNotice('Netskope sincronizó automáticamente 17.891 objetos. Tu vista actual se conserva.'),
    {
      source: 'netskope',
      eyebrow: 'Netskope · ACTUALIZACIÓN',
      title: 'Sincronización automática completada',
      detail: '17.891 objetos · Tu vista actual se conserva.',
    },
  );
  assert.deepEqual(
    presentNotice('Netskope sincronizó parcialmente: parte del inventario no se actualizó. Llegaron 120 objetos. Tu vista actual se conserva; revisá Actividad.'),
    {
      source: 'netskope',
      eyebrow: 'Netskope · ACTUALIZACIÓN',
      title: 'Sincronización automática parcial',
      detail: 'parte del inventario no se actualizó. Llegaron 120 objetos. Tu vista actual se conserva; revisá Actividad.',
    },
  );
  assert.deepEqual(
    presentNotice('Terminó una sincronización automática. Tu vista actual se conserva.'),
    {
      source: null,
      eyebrow: 'CUSTODIA · ACTUALIZACIÓN',
      title: 'Sincronización automática finalizada',
      detail: 'Tu vista actual se conserva.',
    },
  );
});

test('a failed multi-source batch stays a Custodia error notice', () => {
  assert.deepEqual(
    presentNotice('Custodia terminó una sincronización automática con errores. Netskope, CyberArk; revisá Actividad para el detalle.'),
    {
      source: null,
      eyebrow: 'CUSTODIA · ACTUALIZACIÓN',
      title: 'Sincronización automática con errores',
      detail: 'Netskope, CyberArk; revisá Actividad para el detalle.',
    },
  );
});

test('automatic CyberArk source runs collapse into one notice and auxiliary success stays quiet', () => {
  assert.equal(
    automaticSyncBatchNotice([
      { source_system: 'cyberark', status: 'completed', received_safe_count: 436 },
      { source_system: 'sia', status: 'completed' },
      { source_system: 'identity_administration', status: 'completed' },
    ]),
    'CyberArk sincronizó automáticamente. Tu vista actual se conserva.',
  );
  assert.equal(automaticSyncBatchNotice([{ source_system: 'sia', status: 'completed' }]), null);
  assert.equal(
    automaticSyncBatchNotice([
      { source_system: 'cyberark', status: 'completed', received_safe_count: 436 },
      { source_system: 'netskope', status: 'completed' },
    ]),
    'Custodia terminó una sincronización automática. Herramientas actualizadas: CyberArk, Netskope. Tu vista actual se conserva.',
  );
});

test('partial and failed automatic runs are distinguishable from a clean completion', () => {
  assert.equal(
    automaticSyncNotice({ source_system: 'netskope', status: 'partial', received_object_count: 120 }),
    'Netskope sincronizó parcialmente: parte del inventario no se actualizó. Llegaron 120 objetos. Tu vista actual se conserva; revisá Actividad.',
  );
  assert.match(automaticSyncNotice({ source_system: 'netskope', status: 'failed' }), /con errores\. Tu vista actual se conserva; revisá Actividad/);
  assert.match(
    automaticSyncBatchNotice([
      { source_system: 'cyberark', status: 'completed', received_safe_count: 436 },
      { source_system: 'netskope', status: 'partial', received_object_count: 120 },
    ]) || '',
    /sincronizó parcialmente: CyberArk, Netskope/,
  );
  assert.match(
    automaticSyncBatchNotice([
      { source_system: 'cyberark', status: 'failed' },
      { source_system: 'netskope', status: 'partial' },
    ]) || '',
    /con errores\. CyberArk, Netskope; revisá Actividad/,
  );
  assert.equal(
    automaticSyncBatchNotice([
      { source_system: 'cyberark', status: 'completed' },
      { source_system: 'cyberark', status: 'completed' },
      { source_system: 'netskope', status: 'completed' },
    ]),
    'Custodia terminó una sincronización automática. Herramientas actualizadas: CyberArk, Netskope. Tu vista actual se conserva.',
  );
  assert.equal(
    automaticSyncBatchNotice([{ source_system: 'sia', status: 'partial' }]),
    'CyberArk sincronizó parcialmente: parte del inventario no se actualizó. Tu vista actual se conserva; revisá Actividad.',
  );
});

test('tool-cycle grouping keeps CyberArk components together, Netskope separate, and cycles beyond fifteen minutes distinct', () => {
  const base = '2026-10-02T12:00:00Z';
  const groups = groupSyncRunsByToolCycle([
    { run_id: 'pam', source_system: 'cyberark', source_file: 'cyberark-api', status: 'completed', enqueued_at: base, completed_at: '2026-10-02T12:02:00Z', received_safe_count: 4 },
    { run_id: 'sia', source_system: 'sia', status: 'completed', enqueued_at: '2026-10-02T11:59:00Z', completed_at: '2026-10-02T12:03:00Z', received_object_count: 2 },
    { run_id: 'identity', source_system: 'identity_administration', status: 'completed', started_at: '2026-10-02T12:04:00Z', completed_at: '2026-10-02T12:05:00Z', received_object_count: 3 },
    { run_id: 'netskope', source_system: 'netskope', status: 'completed', enqueued_at: '2026-10-02T12:01:00Z', completed_at: '2026-10-02T12:06:00Z', received_object_count: 10 },
    { run_id: 'older-pam', source_system: 'cyberark', status: 'completed', enqueued_at: '2026-10-02T11:44:00Z', completed_at: '2026-10-02T11:45:00Z', received_safe_count: 1 },
  ]);

  assert.equal(groups.length, 3);
  const currentCyberArk = groups.find((group) => group.tool === 'cyberark' && group.runs.length === 3);
  assert.deepEqual(currentCyberArk?.runs.map((run) => run.run_id), ['identity', 'pam', 'sia']);
  assert.equal(currentCyberArk?.received_object_count, 9);
  assert.equal(groups.some((group) => group.tool === 'netskope' && group.runs.length === 1), true);
  assert.equal(groups.some((group) => group.tool === 'cyberark' && group.runs[0]?.run_id === 'older-pam'), true);
});

test('Netskope tasks of one cycle stay one tool group but show as separate components', () => {
  const groups = groupSyncRunsByToolCycle([
    { source_system: 'netskope', source_file: 'netskope-api', status: 'completed', enqueued_at: '2026-10-02T12:00:00Z', received_object_count: 10 },
    { source_system: 'netskope', source_file: 'netskope-alerts-api', status: 'completed', enqueued_at: '2026-10-02T12:00:01Z', received_object_count: 12 },
    { source_system: 'netskope', source_file: 'netskope-dlp-api', status: 'partial', enqueued_at: '2026-10-02T12:00:02Z', received_object_count: 3 },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].components.map((component) => component.label).sort(), ['Netskope', 'Netskope · alertas', 'Netskope · captura DLP']);
  // A partial DLP capture is visible without hiding that the inventory completed.
  assert.deepEqual(groups[0].affectedComponents, [{ label: 'Netskope · captura DLP', status: 'partial' }]);
});

test('grouped state priority preserves failed and partial component names and sums object counts', () => {
  const groups = groupSyncRunsByToolCycle([
    { source_system: 'cyberark', source_file: 'cyberark-api', status: 'running', enqueued_at: '2026-10-02T12:05:00Z', heartbeat_at: '2026-10-02T12:06:00Z', received_object_count: 7, triggered_by: 'system:scheduler' },
    { source_system: 'sia', status: 'failed', enqueued_at: '2026-10-02T12:04:00Z', error_count: 1, triggered_by: 'system:scheduler' },
    { source_system: 'access', status: 'partial', enqueued_at: '2026-10-02T12:03:00Z', received_object_count: 0, received_safe_count: 3, triggered_by: 'operator-1' },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].status, 'running');
  assert.deepEqual(groups[0].affectedComponents, [
    { label: 'SIA', status: 'failed' },
    { label: 'Access space', status: 'partial' },
  ]);
  assert.equal(groups[0].received_object_count, 10);
  assert.equal(groups[0].heartbeat_at, '2026-10-02T12:06:00Z');
  assert.equal(groups[0].automatic, false);

  const terminal = groupSyncRunsByToolCycle([
    { source_system: 'sia', status: 'failed', enqueued_at: '2026-10-02T12:05:00Z' },
    { source_system: 'access', status: 'partial', enqueued_at: '2026-10-02T12:04:00Z' },
    { source_system: 'cyberark', status: 'queued', enqueued_at: '2026-10-02T12:03:00Z' },
    { source_system: 'cyberark', status: 'completed', enqueued_at: '2026-10-02T12:02:00Z' },
  ]);
  assert.equal(terminal[0].status, 'failed');
  assert.equal(terminal[0].automatic, false);
  assert.deepEqual(terminal[0].affectedComponents.map(({ label, status }) => `${status}:${label}`), [
    'failed:SIA',
    'partial:Access space',
  ]);
});

test('a failed run remains visible when the same component has a running retry in its cycle', () => {
  const group = groupSyncRunsByToolCycle([
    { source_system: 'cyberark', source_file: 'cyberark-api', status: 'running', enqueued_at: '2026-10-02T12:05:00Z' },
    { source_system: 'cyberark', source_file: 'cyberark-api', status: 'failed', enqueued_at: '2026-10-02T12:04:00Z', error_count: 1 },
  ])[0];

  assert.equal(group.status, 'running');
  assert.equal(group.components[0].status, 'running');
  assert.deepEqual(group.affectedComponents, [{ label: 'PAM', status: 'failed' }]);
});

test('a completed run with errors marks its component as partially affected', () => {
  const group = groupSyncRunsByToolCycle([
    { source_system: 'sia', status: 'completed', enqueued_at: '2026-10-02T12:04:00Z', error_count: 1 },
  ])[0];

  assert.equal(group.status, 'completed');
  assert.deepEqual(group.affectedComponents, [{ label: 'SIA', status: 'partial' }]);
});

test('grouped completion time is the newest run completion and automatic requires every scheduler run', () => {
  const group = groupSyncRunsByToolCycle([
    { source_system: 'cyberark', status: 'completed', enqueued_at: '2026-10-02T12:00:00Z', completed_at: '2026-10-02T12:04:00Z', triggered_by: 'system:scheduler' },
    { source_system: 'sia', status: 'completed', enqueued_at: '2026-10-02T12:01:00Z', completed_at: '2026-10-02T12:07:00Z', triggered_by: 'system:scheduler' },
  ])[0];

  assert.equal(group.latest_at, '2026-10-02T12:07:00Z');
  assert.equal(group.automatic, true);
});

test('a completed source refreshes only the active product domain', () => {
  assert.equal(refreshDomainForSync('dlp', 'netskope'), true);
  assert.equal(refreshDomainForSync('pam', 'netskope'), false);
  assert.equal(refreshDomainForSync('pam', 'cyberark'), true);
  assert.equal(refreshDomainForSync('dlp', 'cyberark'), false);
});

test('Identity Administration refreshes an open PAM workspace even with a concurrent Netskope event', () => {
  const concurrentSources = ['identity_administration', 'netskope'];
  assert.equal(refreshDomainForEvents('pam', concurrentSources), true);
  assert.equal(refreshDomainForEvents('dlp', concurrentSources), true);
  assert.equal(refreshDomainForEvents('admin', concurrentSources), false);
});

test('a PAM run does not remount DLP when navigation finishes before the run lookup', () => {
  const sources = ['identity_administration'];
  let visibleWorkspace: WorkspaceView = 'identity';
  visibleWorkspace = 'netskope';

  assert.equal(refreshDomainForVisibleWorkspace(visibleWorkspace, sources), null);
});

test('refresh keys remain scoped when PAM and Netskope finish concurrently', () => {
  const sources = ['identity_administration', 'netskope'];
  assert.equal(refreshKeyForVisibleWorkspace('identity', sources), 'pam');
  assert.equal(refreshKeyForVisibleWorkspace('netskopeDevices', sources), 'dlp');
  assert.equal(refreshKeyForVisibleWorkspace('activity', sources), null);
});

test('background sync refreshes only the workspace owned by the source', () => {
  assert.equal(refreshVisibleWorkspaceForSources('safes', ['sia']), false);
  assert.equal(refreshVisibleWorkspaceForSources('safes', ['cyberark']), true);
  assert.equal(refreshVisibleWorkspaceForSources('sia', ['identity_administration']), false);
  assert.equal(refreshVisibleWorkspaceForSources('identity', ['identity_administration']), true);
  assert.equal(refreshVisibleWorkspaceForSources('netskopeDevices', ['netskope']), true);
  assert.equal(refreshVisibleWorkspaceForSources('assets', ['sia']), true);
  assert.equal(refreshVisibleWorkspaceForSources('assets', ['netskope']), false);
});

test('a full manual refresh announces every registered tool, a CyberArk one only CyberArk', () => {
  assert.deepEqual(syncSourcesForScope('cyberark'), ['cyberark']);
  const all = syncSourcesForScope('all');
  assert.equal(all.includes('cyberark'), true);
  assert.equal(all.includes('netskope'), true);
  assert.equal(new Set(all).size, all.length);
});

test('the sync plan is grouped by tool and read from the registry', () => {
  const cyberarkOnly = syncPlanForScope('cyberark');
  assert.deepEqual(cyberarkOnly.map((entry) => entry.tool), ['cyberark']);
  const all = syncPlanForScope('all');
  assert.deepEqual(all.map((entry) => entry.tool).sort(), ['cyberark', 'netskope']);
  const cyberark = all.find((entry) => entry.tool === 'cyberark')!;
  for (const component of ['PAM', 'Identity Administration', 'SIA', 'Access space']) assert.equal(cyberark.components.includes(component), true, component);
  const netskope = all.find((entry) => entry.tool === 'netskope')!;
  assert.equal(netskope.components.includes('Netskope · captura DLP'), true);
  for (const entry of all) assert.equal(new Set(entry.components).size, entry.components.length);
});

test('a notice raised from a tool workspace takes that tool when its text names none', () => {
  assert.deepEqual(
    presentNotice('CSV de destinos descargado', 'cyberark'),
    { source: 'cyberark', eyebrow: 'CyberArk · ACTUALIZACIÓN', title: 'CSV de destinos descargado' },
  );
  assert.equal(presentNotice('CSV de destinos descargado').source, null);
  assert.equal(syncSourceForArea('pam'), 'cyberark');
  assert.equal(syncSourceForArea('dlp'), 'netskope');
  assert.equal(syncSourceForArea('admin'), null);
});
