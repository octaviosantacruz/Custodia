import assert from 'node:assert/strict';
import test from 'node:test';
import { cyberarkSeverityLabel, cyberarkStatusLabel, cyberarkStatusTone } from '../../../src/cyberark/risk_management/lib/cyberark-risk-labels.ts';

test('observed CyberArk status and severity literals get Spanish labels regardless of case', () => {
  assert.deepEqual(cyberarkStatusLabel('open'), { label: 'Abierto', known: true });
  assert.deepEqual(cyberarkStatusLabel('OPEN'), { label: 'Abierto', known: true });
  assert.deepEqual(cyberarkStatusLabel('Open'), { label: 'Abierto', known: true });
  for (const [literal, label] of [['critical', 'Crítica'], ['high', 'Alta'], ['medium', 'Media'], ['low', 'Baja']] as const) {
    assert.deepEqual(cyberarkSeverityLabel(literal), { label, known: true });
  }
});

test('unknown CyberArk values keep their original literal and a missing value says Sin dato', () => {
  for (const literal of ['in progress', 'In Progress', 'risk accepted', 'severe', 'OPEN ']) {
    const expected = literal === 'OPEN ' ? { label: 'Abierto', known: true } : { label: literal, known: false };
    assert.deepEqual(cyberarkStatusLabel(literal), expected);
  }
  assert.deepEqual(cyberarkStatusLabel(null), { label: 'Sin dato', known: false });
  assert.deepEqual(cyberarkStatusLabel(''), { label: 'Sin dato', known: false });
  assert.deepEqual(cyberarkSeverityLabel('moderate'), { label: 'moderate', known: false });
  assert.deepEqual(cyberarkSeverityLabel(null), { label: 'Sin dato', known: false });
});

test('open keeps the danger tone of a locally open finding; unknown statuses stay neutral', () => {
  assert.equal(cyberarkStatusTone('OPEN'), 'danger');
  assert.equal(cyberarkStatusTone('risk accepted'), 'neutral');
  assert.equal(cyberarkStatusTone(null), 'neutral');
});
