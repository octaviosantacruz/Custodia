import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceActivityPoll, initialActivityPollState } from '../../src/cross/lib/activity-poll.ts';
import type { ActivityEvent } from '../../src/cross/lib/activity-events-api.ts';

function event(event_id: number): ActivityEvent {
  return {
    event_id, kind: 'sync', actor_id: 'system:scheduler', actor_name: 'Scheduler',
    run_id: null, source_system: 'netskope', created_at: '2026-09-23T00:00:00Z',
  };
}

test('a cold start with a backlog larger than one page does not notify about it', () => {
  // A fresh login/reload starts from since=0. If the backend has more
  // history than one page, the second (and later) catch-up pages must not
  // be treated as brand-new external events -- that replayed old sync
  // failures as fresh toasts on every login.
  const page1 = Array.from({ length: 3 }, (_, i) => event(i + 1));
  const first = advanceActivityPoll(initialActivityPollState, page1, 3);
  assert.equal(first.state.initialized, false);
  assert.deepEqual(first.notify, []);

  const page2 = [event(4)];
  const second = advanceActivityPoll(first.state, page2, 3);
  assert.equal(second.state.initialized, true);
  assert.deepEqual(second.notify, []);
  assert.equal(second.state.since, 4);
});

test('a cold start with a single, non-full page is immediately caught up', () => {
  const rows = [event(1), event(2)];
  const result = advanceActivityPoll(initialActivityPollState, rows, 100);
  assert.equal(result.state.initialized, true);
  assert.deepEqual(result.notify, []);
  assert.equal(result.state.since, 2);
});

test('once initialized, a new page is surfaced for notification', () => {
  const initialized = { since: 4, initialized: true };
  const rows = [event(5)];
  const result = advanceActivityPoll(initialized, rows);
  assert.equal(result.state.initialized, true);
  assert.deepEqual(result.notify, rows);
  assert.equal(result.state.since, 5);
});

test('an empty page marks the stream caught up without advancing the cursor', () => {
  const result = advanceActivityPoll(initialActivityPollState, []);
  assert.equal(result.state.initialized, true);
  assert.equal(result.state.since, 0);
  assert.deepEqual(result.notify, []);
});
