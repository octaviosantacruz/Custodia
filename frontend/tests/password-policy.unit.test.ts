import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePassword, passwordFeedback, MIN_PASSWORD_LENGTH, passwordChecks, passwordRequirements } from '../src/lib/password-policy.ts';

test('each requirement is independent; whitespace is not a symbol', () => {
  assert.deepEqual(passwordChecks(''), [false, false, false]);
  assert.deepEqual(passwordChecks('abcdefghijk!'), [true, false, true]);
  assert.deepEqual(passwordChecks('abcdefghijk1'), [true, true, false]);
  assert.deepEqual(passwordChecks('abcdefghij1 '), [true, true, false]);
  assert.deepEqual(passwordChecks('abcdefghij١!'), [true, false, true]);
  assert.deepEqual(passwordChecks('abcdefghij1!'), [true, true, true]);
});

test('length uses Unicode code points and matches backend limits', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.deepEqual(passwordChecks('a'.repeat(9) + '1😀'), [false, true, true]);
  assert.deepEqual(passwordChecks('a'.repeat(10) + '1😀'), [true, true, true]);
  assert.deepEqual(passwordChecks('a'.repeat(10) + '1€'), [true, true, true]);
  assert.equal(passwordChecks('a'.repeat(126) + '1!')[0], true);
  assert.equal(passwordChecks('a'.repeat(127) + '1!')[0], false);
});

test('requirements label length, number and symbol in order', () => {
  const requirements = passwordRequirements('abcdefghijk1');
  assert.deepEqual(requirements.map(({ valid }) => valid), [true, true, false]);
  assert.equal(requirements[0].label, 'Mínimo 12 caracteres');
  assert.match(requirements[1].label, /número/);
  assert.match(requirements[2].label, /símbolo/);
});

test('progress only completes when all requirements pass and reverses on deletion', () => {
  assert.deepEqual(passwordFeedback('', ''), { valid: false, remaining: 12, progress: 0, matches: false });
  assert.deepEqual(passwordFeedback('abcdefghij1!', 'abcdefghij1!'), { valid: true, remaining: 0, progress: 100, matches: true });
  const incomplete = passwordFeedback('abcdefghij1', 'abcdefghij1!');
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.matches, false);
  assert.equal(incomplete.remaining, 1);
  assert.ok(incomplete.progress < 100);
  assert.ok(passwordFeedback('a'.repeat(20), '').progress < 100);
});

test('generated passwords always satisfy all requirements', () => {
  const values = new Set<string>();
  for (let index = 0; index < 100; index++) {
    const value = generatePassword();
    assert.equal(value.length, MIN_PASSWORD_LENGTH);
    assert.deepEqual(passwordChecks(value), [true, true, true]);
    values.add(value);
  }
  assert.ok(values.size > 1);
});
