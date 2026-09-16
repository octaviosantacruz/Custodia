import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCommands, commandShortcutLabel, recordRecentWorkspace, type CommandCenterCommand } from '../src/lib/command-center.ts';

const commands: CommandCenterCommand[] = [
  { id: 'safes', group: 'tools', label: 'Abrir Safes', detail: 'Inventario', keywords: ['pam'], permission: 'inventory:read' },
  { id: 'sync', group: 'actions', label: 'Sincronizar PAM', detail: 'Ingesta', keywords: ['sync'], permission: 'ingestion:run' },
];

test('command center only discovers commands the actor is permitted to use', () => {
  assert.deepEqual(
    availableCommands(commands, '', ['inventory:read']).map((command) => command.id),
    ['safes'],
  );
  assert.deepEqual(
    availableCommands(commands, 'sync', ['inventory:read', 'ingestion:run']).map((command) => command.id),
    ['sync'],
  );
});

test('command center labels the shortcut for Apple and non-Apple devices', () => {
  assert.equal(commandShortcutLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X)'), '⌘ K');
  assert.equal(commandShortcutLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Ctrl K');
});

test('recent workspaces are de-duplicated, newest first, and bounded', () => {
  assert.deepEqual(recordRecentWorkspace('sia', ['safes', 'sia', 'identity'], 3), ['sia', 'safes', 'identity']);
});
