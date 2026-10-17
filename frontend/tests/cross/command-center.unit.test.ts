import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandMatchTier, commandShortcutLabel, emptyStateSections, isCommandAvailable,
  matchesCommandFilters, navigationCommands, normalizeCommandQuery, rankCommands, recordRecentWorkspace,
  SEARCH_RESULT_META, widgetCommands, type CommandCenterCommand,
} from '../../src/cross/lib/command-center.ts';
import { loadWidgetCommandSources } from '../../src/sources.ts';
import { CATALOG_BY_ID } from '../../src/cross/lib/workspace-catalog.ts';
import { areaOf } from '../../src/cross/lib/domains.ts';

/* Bundle-size follow-up to UX-SEARCH-001: command-center.ts no longer
   imports the widget catalogs eagerly (they're now loaded on demand by
   GlobalSearch via `loadWidgetCommandSources`), so the tests that exercise
   real widget commands load them once here, the same way the real UI does. */
const widgetSources = await loadWidgetCommandSources();

function fixture(overrides: Partial<CommandCenterCommand> & { id: string }): CommandCenterCommand {
  return {
    kind: 'view', platform: 'cyberark', label: overrides.id, detail: '', aliases: [], priority: 50,
    ...overrides,
  };
}

test('command search normalizes case, accents and repeated spaces', () => {
  assert.equal(normalizeCommandQuery('  Métricas   PAM '), 'metricas pam');
  assert.equal(normalizeCommandQuery('IDENTIDAD'), 'identidad');
  assert.equal(normalizeCommandQuery('compañía'), 'compania');
  assert.equal(normalizeCommandQuery('ñandú'), 'nandu');
  assert.equal(normalizeCommandQuery('   '), '');
});

test('command matching ranks exact, prefix, token and partial matches in that order', () => {
  const commands = [
    fixture({ id: 'partial', label: 'Superpersonas' }),
    fixture({ id: 'token', label: 'Gente Persona Operación' }),
    fixture({ id: 'prefix', label: 'Personas' }),
    fixture({ id: 'exact', label: 'Persona' }),
  ];
  assert.deepEqual(rankCommands(commands, 'persona', []).map((command) => command.id), ['exact', 'prefix', 'token', 'partial']);
  assert.equal(commandMatchTier(commands[0], 'persona'), 'partial');
  assert.equal(commandMatchTier(commands[1], 'persona'), 'token');
  assert.equal(commandMatchTier(commands[2], 'persona'), 'prefix');
  assert.equal(commandMatchTier(commands[3], 'persona'), 'exact');
  assert.equal(commandMatchTier(commands[3], 'inexistente'), null);
});

test('accents and aliases are searchable without library fuzzy matching', () => {
  const command = fixture({ id: 'metricas', label: 'Métricas', aliases: ['dashboard'] });
  assert.equal(commandMatchTier(command, 'metricas'), 'exact');
  assert.equal(commandMatchTier(command, 'metri'), 'prefix');
  assert.equal(commandMatchTier(command, 'dashboard'), 'exact');
  assert.equal(commandMatchTier(command, 'dash'), 'prefix');
});

test('priority and recency break ties without overriding the match tier', () => {
  const commands = [
    fixture({ id: 'low', label: 'Persona amplia', priority: 90 }),
    fixture({ id: 'high', label: 'Persona principal', priority: 10 }),
    fixture({ id: 'recent', label: 'Persona reciente', priority: 10, workspace: 'safes' }),
  ];
  assert.deepEqual(
    rankCommands(commands, 'persona', []).map((command) => command.id),
    ['high', 'recent', 'low'],
  );
  // Equal tier and priority: recency decides, exactly as the empty state expects.
  assert.deepEqual(
    rankCommands(commands, 'persona', [], { recentIds: ['safes'] }).map((command) => command.id),
    ['recent', 'high', 'low'],
  );
  // Recovery must never rank a worse match above a better one.
  const betterButOld = fixture({ id: 'exact-old', label: 'Persona', priority: 99 });
  const worseButRecent = fixture({ id: 'partial-new', label: 'Superpersonas', priority: 1, workspace: 'safes' });
  assert.deepEqual(
    rankCommands([worseButRecent, betterButOld], 'persona', [], { recentIds: ['safes'] }).map((command) => command.id),
    ['exact-old', 'partial-new'],
  );
});

test('navigation commands derive from the catalog with one entry per authorized workspace', () => {
  const commands = navigationCommands(['pam:catalogs_read']);
  const ids = commands.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate command ids');
  const views = commands.map((command) => command.workspace);
  assert.equal(new Set(views).size, views.length, 'no duplicate workspaces');
  assert.ok(views.includes('person'));
  assert.ok(views.includes('graph'));
  assert.ok(!views.includes('users'));
  assert.ok(!views.includes('activity'));
  assert.ok(!views.includes('netskope'));
  for (const command of commands) {
    assert.equal(command.kind, 'view');
    assert.equal(command.platform === 'cyberark' || command.platform === 'netskope' || command.platform === 'custodia', true);
    const entry = CATALOG_BY_ID[command.workspace!];
    assert.equal(entry.catalog, true, `${command.id} must be an advertised destination`);
    assert.equal(command.label, entry.label);
    assert.equal(command.detail, entry.detail);
  }
});

test('an unauthorized view never appears and a restricted destination is never granted', () => {
  const reader = navigationCommands(['inventory:read']);
  for (const workspace of ['users', 'activity', 'netskope', 'graph', 'person', 'platforms'] as const) {
    assert.equal(reader.some((command) => command.workspace === workspace), false, `${workspace} stays hidden`);
  }
  assert.equal(reader.filter((command) => command.workspace === 'safes').length, 1);
});

test('Personas is classified as a Conexiones view even though it renders through PAM', () => {
  const [person] = navigationCommands(['pam:catalogs_read']).filter((command) => command.workspace === 'person');
  assert.equal(person.platform, 'custodia');
  assert.equal(person.kind, 'view');
  assert.equal(areaOf('person'), 'cross');
});

test('Command-K distinguishes Conexiones from the infrastructure inventory destination', () => {
  const permissions = ['netskope:read'];
  const commands = navigationCommands(permissions);
  const connectionMatches = rankCommands(commands, 'Conexiones', permissions);
  assert.equal(connectionMatches[0]?.workspace, 'person');
  assert.equal(connectionMatches.some((command) => command.workspace === 'assets'), false);
  assert.equal(rankCommands(commands, 'Personas', permissions)[0]?.workspace, 'person');

  const infrastructure = rankCommands(commands, 'Inventario de infraestructura', permissions);
  assert.equal(infrastructure[0]?.workspace, 'assets');
  assert.equal(infrastructure[0]?.label, 'Cobertura');
  assert.equal(rankCommands(commands, 'Activos y conexiones', permissions).some((command) => command.workspace === 'assets'), false);
  assert.equal(commands.some((command) => command.label === 'Activos y conexiones'), false);
  assert.equal(commands.some((command) => command.label === 'Riesgos'), false);
});

test('searching the documented examples ranks the expected destination first', () => {
  const permissions = ['access:manage', 'inventory:read', 'netskope:read'];
  const commands = [...navigationCommands(permissions), ...widgetCommands(permissions, widgetSources)];
  assert.equal(rankCommands(commands, 'persona', permissions)[0].workspace, 'person');
  assert.equal(rankCommands(commands, 'safe', permissions)[0].workspace, 'safes');
  assert.equal(rankCommands(commands, 'identidad', permissions)[0].workspace, 'identity');
  assert.equal(rankCommands(commands, 'netskope', permissions)[0].platform, 'netskope');
  assert.equal(rankCommands(commands, 'widget', permissions).every((command) => command.kind === 'widget'), true);
  assert.equal(rankCommands(commands, 'usuarios custodia', permissions)[0].workspace, 'users');
  const metricViews = rankCommands(commands, 'métricas', permissions)
    .slice(0, 2)
    .map((command) => command.workspace)
    .sort();
  assert.deepEqual(metricViews, ['general', 'netskope']);
});

test('empty-state platforms always follow CyberArk, Netskope, Custodia order', () => {
  const permissions = ['access:manage'];
  const commands = navigationCommands(permissions);
  const sections = emptyStateSections(commands, permissions, ['netskopeInventory', 'safes', 'person'], []);
  const quick = sections.find((section) => section.id === 'quick');
  assert.deepEqual(quick?.groups.map((group) => group.platform), ['cyberark', 'netskope', 'custodia']);
  assert.deepEqual(quick?.groups.flatMap((group) => group.commands.map((command) => command.workspace)), ['safes', 'netskopeInventory', 'person']);
  const recent = sections.find((section) => section.id === 'recent');
  assert.equal(recent, undefined);
  // Quick access and recents never repeat a destination in "más vistas".
  const claimed = new Set([
    ...(sections.find((section) => section.id === 'quick')?.groups.flatMap((group) => group.commands.map((command) => command.id)) ?? []),
    ...(recent?.groups.flatMap((group) => group.commands.map((command) => command.id)) ?? []),
  ]);
  const more = sections.find((section) => section.id === 'more');
  assert.ok(more);
  for (const group of more!.groups) for (const command of group.commands) assert.equal(claimed.has(command.id), false);
});

test('platform and kind chips filter local commands and remote inventory alike', () => {
  const permissions = ['access:manage', 'inventory:read', 'netskope:read'];
  const commands = [
    ...navigationCommands(permissions),
    ...widgetCommands(permissions, widgetSources),
    fixture({ id: 'action-sync', kind: 'action', platform: 'custodia', label: 'Actualizar datos' }),
  ];
  const custodia = commands.filter((command) => matchesCommandFilters(command, 'custodia', 'all'));
  assert.ok(custodia.length > 0);
  assert.equal(custodia.every((command) => command.platform === 'custodia'), true);
  const actions = commands.filter((command) => matchesCommandFilters(command, 'all', 'action'));
  assert.deepEqual(actions.map((command) => command.id), ['action-sync']);
  const widgets = commands.filter((command) => matchesCommandFilters(command, 'netskope', 'widget'));
  assert.equal(widgets.length > 0, true);
  assert.equal(widgets.every((command) => command.platform === 'netskope' && command.kind === 'widget'), true);
  assert.equal(matchesCommandFilters(SEARCH_RESULT_META.safe, 'netskope', 'all'), false);
  assert.equal(matchesCommandFilters(SEARCH_RESULT_META.safe, 'all', 'inventory'), true);
  assert.equal(matchesCommandFilters(SEARCH_RESULT_META.safe, 'cyberark', 'view'), false);
});

test('remote inventory results declare type and platform explicitly, never from the label', () => {
  assert.deepEqual(
    Object.keys(SEARCH_RESULT_META).sort(),
    ['account', 'connection', 'identity_role', 'identity_user', 'pam_role', 'pam_user', 'safe', 'sia_policy'],
  );
  for (const [type, meta] of Object.entries(SEARCH_RESULT_META)) {
    assert.equal(meta.kind, 'inventory', type);
    assert.equal(meta.platform, 'cyberark', type);
    assert.ok(meta.groupLabel.length > 0, type);
  }
});

test('widgets are navigable shortcuts that never mutate dashboard preferences', () => {
  const commands = widgetCommands(['inventory:read', 'netskope:read'], widgetSources);
  const ids = commands.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate widget ids');
  assert.ok(commands.length > 20, 'the real PAM and Netskope widget definitions are registered');
  assert.ok(commands.some((command) => command.label === 'Safes por empresa'));
  assert.ok(commands.some((command) => command.label === 'Dispositivos por sistema operativo'));
  for (const command of commands) {
    assert.equal(command.kind, 'widget');
    assert.equal(command.run, undefined, 'a widget result only navigates; it never persists or reorders');
    assert.ok(command.aliases.includes('widget'));
    assert.equal(command.platform === 'cyberark' ? command.workspace === 'general' : command.workspace === 'netskope', true);
  }
  assert.equal(widgetCommands(['inventory:read'], widgetSources).some((command) => command.platform === 'netskope'), false);
  assert.equal(widgetCommands(['netskope:read'], widgetSources).some((command) => command.platform === 'cyberark'), false);
  // access:manage opens the Netskope dashboard workspace, so its widgets are
  // offered too (the same rule the netskope view uses); PAM keeps inventory:read.
  assert.equal(widgetCommands(['access:manage'], widgetSources).some((command) => command.platform === 'netskope'), true);
  assert.equal(widgetCommands(['access:manage'], widgetSources).some((command) => command.platform === 'cyberark'), false);
  assert.equal(widgetCommands([], widgetSources).length, 0);
});

test('widgetCommands is a pure adapter: no sources means no widget commands, never a partial guess', () => {
  // Bundle-size follow-up to UX-SEARCH-001: before GlobalSearch's import()
  // resolves, `sources` is null. The adapter must not fabricate widgets from
  // stale/empty data or throw; it simply reports nothing yet.
  assert.deepEqual(widgetCommands(['inventory:read', 'netskope:read', 'access:manage'], null), []);
  assert.deepEqual(widgetCommands([], null), []);
});

test('command availability honors single and alternate permissions', () => {
  assert.equal(isCommandAvailable({}, []), true);
  assert.equal(isCommandAvailable({ permission: 'ingestion:run' }, []), false);
  assert.equal(isCommandAvailable({ permission: 'ingestion:run' }, ['ingestion:run']), true);
  assert.equal(isCommandAvailable({ permission: ['access:manage', 'audit:read'] }, ['audit:read']), true);
  assert.equal(isCommandAvailable({ permission: ['access:manage', 'audit:read'] }, ['inventory:read']), false);
});

test('command center labels the shortcut for Apple and non-Apple devices', () => {
  assert.equal(commandShortcutLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X)'), '⌘ K');
  assert.equal(commandShortcutLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Ctrl K');
});

test('recent workspaces are de-duplicated, newest first, and bounded', () => {
  assert.deepEqual(recordRecentWorkspace('sia', ['safes', 'sia', 'identity'], 3), ['sia', 'safes', 'identity']);
});
