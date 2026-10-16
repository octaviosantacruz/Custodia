import type { ActivityEvent } from './activity-events-api';

/** Must match the backend's default page size for GET /api/events (see
 * api/routes/events.py). */
export const EVENTS_PAGE_LIMIT = 100;

export type ActivityPollState = { since: number; initialized: boolean };

export const initialActivityPollState: ActivityPollState = { since: 0, initialized: false };

/** Decide what a poll response means for the tracked cursor and which rows,
 * if any, are new external events to notify about.
 *
 * A cold start (login, reload) begins from since=0 and can have more
 * backlog than one page. This keeps silently advancing through it instead
 * of only skipping the first page: a full page means more history may
 * follow, and treating it as "caught up" there would replay old events
 * (e.g. a sync failure from days ago) as new the moment the next page is
 * fetched.
 */
export function advanceActivityPoll(
  state: ActivityPollState,
  rows: readonly ActivityEvent[],
  pageLimit: number = EVENTS_PAGE_LIMIT,
): { state: ActivityPollState; notify: readonly ActivityEvent[] } {
  if (rows.length === 0) return { state: { ...state, initialized: true }, notify: [] };
  const newestId = rows[rows.length - 1].event_id;
  const caughtUp = state.initialized || rows.length < pageLimit;
  const nextState = { since: newestId, initialized: caughtUp };
  if (!state.initialized) return { state: nextState, notify: [] };
  return { state: nextState, notify: rows };
}
