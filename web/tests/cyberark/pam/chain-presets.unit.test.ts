import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAIN_PRESETS, presetApplies } from '../../../src/cyberark/pam/lib/chain-presets.ts';

test('presets only use persisted fields and are versioned in code', () => {
  const ids = CHAIN_PRESETS.map((preset) => preset.id);
  assert.deepEqual(ids, ['who-reaches-psm', 'what-role-reaches', 'suspended-users']);
  for (const preset of CHAIN_PRESETS) {
    assert.ok(preset.direction || preset.search, `${preset.id} must resolve an action`);
    if (preset.search) {
      assert.ok(preset.search.types.length > 0);
      assert.ok(['', 'suspended'].includes(preset.search.status ?? ''));
    }
  }
});

test('direction presets only enable on their node type', () => {
  const psmPreset = CHAIN_PRESETS.find((preset) => preset.id === 'who-reaches-psm')!;
  assert.equal(presetApplies(psmPreset, 'psm'), true);
  assert.equal(presetApplies(psmPreset, 'role'), false);
  assert.equal(presetApplies(psmPreset, null), false);

  const rolePreset = CHAIN_PRESETS.find((preset) => preset.id === 'what-role-reaches')!;
  assert.equal(rolePreset.direction, 'forward');
  assert.equal(presetApplies(rolePreset, 'role'), true);
  assert.equal(presetApplies(rolePreset, 'safe'), false);

  const suspended = CHAIN_PRESETS.find((preset) => preset.id === 'suspended-users')!;
  assert.equal(presetApplies(suspended, null), true);
});
