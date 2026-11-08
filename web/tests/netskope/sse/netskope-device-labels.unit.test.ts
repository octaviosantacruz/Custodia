import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceMakeModelLabel } from '../../../src/netskope/sse/lib/netskope-device-labels.ts';

test('device labels omit manufacturer names already present in the model', () => {
  assert.equal(deviceMakeModelLabel('HP', 'HP ProBook 450'), 'HP ProBook 450');
  assert.equal(deviceMakeModelLabel('Hewlett-Packard', 'HP 250'), 'HP 250');
  assert.equal(deviceMakeModelLabel('Dell', 'Latitude 5540'), 'Dell Latitude 5540');
  assert.equal(deviceMakeModelLabel('', 'Latitude 5540'), 'Latitude 5540');
});
