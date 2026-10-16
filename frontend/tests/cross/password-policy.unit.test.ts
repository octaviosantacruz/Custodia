import assert from 'node:assert/strict';
import test from 'node:test';

import { generatePassword, MIN_PASSWORD_LENGTH, passwordChecks, passwordRequirements } from '../../src/cross/lib/password-policy.ts';

test('passwordChecks: rejects a password missing every rule', () => {
  assert.deepEqual(passwordChecks(''), [false]);
});

test('passwordChecks: accepts any character set at the minimum length', () => {
  assert.deepEqual(passwordChecks('abcdefghijklmno'), [true]);
  assert.deepEqual(passwordChecks('123456789012345'), [true]);
  assert.deepEqual(passwordChecks('short'), [false]);
});

test('passwordRequirements: pairs each rule with its Spanish label in a stable order', () => {
  const requirements = passwordRequirements('Abcdef123456789!');
  assert.deepEqual(requirements.map((item) => item.label), [
    `${MIN_PASSWORD_LENGTH} caracteres`,
  ]);
  assert.equal(requirements.every((item) => item.valid), true);
});

test('passwordRequirements: reports only the unmet rules as invalid', () => {
  const requirements = passwordRequirements('alllowercase');
  const invalidLabels = requirements.filter((item) => !item.valid).map((item) => item.label);
  assert.deepEqual(invalidLabels, [`${MIN_PASSWORD_LENGTH} caracteres`]);
});

test('generatePassword: always satisfies the minimum-length policy', () => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const generated = generatePassword();
    assert.deepEqual(passwordChecks(generated), [true], `generated password failed the length rule: ${generated}`);
  }
});

test('generatePassword: produces the configured minimum length', () => {
  assert.equal(generatePassword().length, MIN_PASSWORD_LENGTH);
});

test('generatePassword: does not repeat the same value across calls', () => {
  const first = generatePassword();
  const second = generatePassword();
  assert.notEqual(first, second);
});
