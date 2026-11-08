import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GUIDE_SECTION, GUIDE_SECTIONS, guideSection, guideSectionFromSearch, guideSectionPath, shouldShowApiReference,
} from '../../src/cross/content/guide-sections.ts';
import { GUIDE_CONTENT, type GuideBlock } from '../../src/cross/content/product-guide.ts';
import { CATALOG_BY_ID, CATALOG_ENTRIES } from '../../src/cross/lib/workspace-catalog.ts';
import { emptyStateSections, guideCommands, navigationCommands, rankCommands } from '../../src/cross/lib/command-center.ts';

const REQUIRED_ORDER = [
  'Primeros pasos', 'Personas', 'CyberArk PAM', 'Identity Administration', 'SIA', 'Access',
  'Netskope', 'Tableros y widgets', 'Administración y permisos', 'Casos de uso',
  'Significado y frescura de datos', 'API para desarrolladores',
];

function blockText(block: GuideBlock): string[] {
  if (block.kind === 'paragraph' || block.kind === 'note') return [block.text];
  if (block.kind === 'steps' || block.kind === 'bullets') return [...block.items];
  return [];
}

test('the editorial index keeps unique ids in the required order', () => {
  assert.deepEqual(GUIDE_SECTIONS.map((section) => section.title), REQUIRED_ORDER);
  const ids = GUIDE_SECTIONS.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(DEFAULT_GUIDE_SECTION, GUIDE_SECTIONS[0].id);
  assert.deepEqual(Object.keys(GUIDE_CONTENT).sort(), [...ids].sort());
});

test('every section declares owner, update rule, summary and content', () => {
  for (const section of GUIDE_SECTIONS) {
    assert.ok(section.summary.length > 20, section.id);
    assert.ok(section.owner.length > 0, section.id);
    assert.ok(section.updateRule.length > 0, section.id);
    assert.ok(section.aliases.length > 0, section.id);
    assert.ok(GUIDE_CONTENT[section.id].blocks.length > 0, section.id);
  }
});

test('deep links are stable and unknown sections fall back safely', () => {
  assert.equal(guideSectionPath('personas'), '/help?section=personas');
  assert.equal(guideSectionPath('cyberark-sia'), '/help?section=cyberark-sia');
  assert.equal(guideSectionFromSearch('?section=cyberark-sia'), 'cyberark-sia');
  assert.equal(guideSectionFromSearch('section=api'), 'api');
  assert.equal(guideSectionFromSearch(''), DEFAULT_GUIDE_SECTION);
  assert.equal(guideSectionFromSearch('?section=no-existe'), DEFAULT_GUIDE_SECTION);
  assert.equal(guideSection('no-existe'), undefined);
});

test('every advertised switcher destination has an explicit section link', () => {
  const linked = new Set<string>();
  for (const section of GUIDE_SECTIONS) {
    for (const link of GUIDE_CONTENT[section.id].links ?? []) {
      const entry = CATALOG_BY_ID[link.view];
      assert.ok(entry, `${section.id} -> ${link.view} must exist in the catalog`);
      assert.equal(entry.catalog, true, `${link.view} must be an advertised destination`);
      linked.add(link.view);
    }
  }
  for (const entry of CATALOG_ENTRIES) {
    if (!entry.switcher || entry.id === 'help') continue;
    assert.ok(linked.has(entry.id), `${entry.id} needs an explicit guide link`);
  }
});

test('planned capabilities are not presented as available', () => {
  for (const section of GUIDE_SECTIONS) {
    for (const link of GUIDE_CONTENT[section.id].links ?? []) {
      assert.notEqual(CATALOG_BY_ID[link.view].domain, 'dspm', `${link.view} is planned and must not be linked`);
    }
  }
  const bigIdMentions = GUIDE_SECTIONS
    .flatMap((section) => GUIDE_CONTENT[section.id].blocks)
    .flatMap(blockText)
    .filter((text) => /BigID/i.test(text));
  assert.equal(bigIdMentions.length, 1);
  assert.match(bigIdMentions[0], /Próximamente/);
});

test('the guide describes Conexiones with client evidence inside Personas', () => {
  const firstSteps = GUIDE_CONTENT['primeros-pasos'].blocks.flatMap(blockText).join(' ');
  const people = GUIDE_CONTENT.personas.blocks.flatMap(blockText).join(' ');
  const allGuideText = Object.values(GUIDE_CONTENT).flatMap((section) => section.blocks.flatMap(blockText)).join(' ');
  assert.match(firstSteps, /Conexiones es la herramienta transversal/);
  assert.match(firstSteps, /vive aparte, en Administración/);
  assert.match(people, /En el panel Netskope podés abrir la evidencia del cliente/);
  assert.match(people, /requiere lectura de Identity Administration y Netskope/);
  assert.doesNotMatch(allGuideText, /Riesgos.*próximamente|Riesgos.*no habilitado/i);
  assert.equal(CATALOG_BY_ID.assets.label, 'Cobertura');
  assert.ok(GUIDE_CONTENT['casos-de-uso'].links?.some((link) => link.view === 'assets' && link.label === 'Abrir Cobertura'));
});

test('the /docs link only appears with the authenticated deployment signal', () => {
  assert.equal(shouldShowApiReference({ authenticated: true, api_docs_enabled: true }), true);
  assert.equal(shouldShowApiReference({ authenticated: true, api_docs_enabled: false }), false);
  assert.equal(shouldShowApiReference({ authenticated: false, api_docs_enabled: true }), false);
  assert.equal(shouldShowApiReference({}), false);
  assert.equal(shouldShowApiReference(null), false);
  const apiBlock = GUIDE_CONTENT.api.blocks.find((block) => block.kind === 'api-reference');
  assert.ok(apiBlock && apiBlock.kind === 'api-reference');
  assert.match(apiBlock.enabledText, /referencia/i);
  assert.match(apiBlock.disabledText, /exposición directa/i);
  // The guide describes the real token contract without inventing endpoints.
  const apiText = GUIDE_CONTENT.api.blocks.flatMap(blockText).join(' ');
  assert.match(apiText, /Authorization: Bearer/);
  assert.match(apiText, /X-Access-Token/);
});

test('Command-K finds every section with the guide names and keeps them out of the browse list', () => {
  const commands = guideCommands();
  assert.deepEqual(commands.map((command) => command.label), GUIDE_SECTIONS.map((section) => section.title));
  const ids = commands.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const command of commands) {
    assert.equal(command.kind, 'view');
    assert.equal(command.platform, 'dshub');
    assert.equal(command.workspace, 'help');
    assert.ok(command.sectionId, command.id);
    assert.equal(command.hideInEmptyState, true, command.id);
    assert.equal(command.run, undefined, 'the App binds navigation; the builder stays pure');
  }
  const helpViews = navigationCommands([]).filter((command) => command.workspace === 'help');
  assert.equal(helpViews.length, 1);
  assert.equal(helpViews[0].label, 'Ayuda');

  const all = [...navigationCommands([]), ...commands];
  assert.equal(rankCommands(all, 'casos de uso', [])[0].sectionId, 'casos-de-uso');
  assert.equal(rankCommands(all, 'significado', [])[0].sectionId, 'datos');
  assert.equal(rankCommands(all, 'ayuda', [])[0].workspace, 'help');

  const sections = emptyStateSections(all, [], [], []);
  const browsable = sections.flatMap((section) => section.groups.flatMap((group) => group.commands.map((command) => command.id)));
  assert.ok(browsable.includes('view-help'), 'the guide entry itself stays browsable');
  assert.equal(browsable.some((id) => id.startsWith('guide-')), false, 'section commands are search-only');
});

test('guide sections follow the guide aliases for their documented topics', () => {
  const all = [...navigationCommands([]), ...guideCommands()];
  assert.equal(guideSection(rankCommands(all, 'persona', [])[0].sectionId)?.id, 'personas');
  assert.equal(guideSection(rankCommands(all, 'openapi', [])[0].sectionId)?.id, 'api');
  assert.equal(guideSection(rankCommands(all, 'frescura', [])[0].sectionId)?.id, 'datos');
});

test('the Netskope guide holds the long reading the board cards no longer repeat', () => {
  const text = GUIDE_CONTENT.netskope.blocks.flatMap(blockText).join('\n');
  assert.match(text, /«Diferencia frente a Netskope»/);
  assert.match(text, /cuenta filas, no identidades distintas/);
  assert.match(text, /no se puede conciliar con exactitud/);
  assert.match(text, /Diferencias esperadas frente a la consola/);
});
