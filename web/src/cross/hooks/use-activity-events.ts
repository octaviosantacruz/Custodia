import { useEffect, useRef, useState } from 'react';
import { listActivityEvents, type ActivityEvent } from '../lib/activity-events-api';
import { advanceActivityPoll, initialActivityPollState, type ActivityPollState } from '../lib/activity-poll';

const POLL_INTERVAL_MS = 20_000;

type UseActivityEventsOptions = {
  authenticated: boolean;
  currentActorId?: string;
  onExternalEvents: (events: ActivityEvent[]) => void;
};

export function useActivityEvents({
  authenticated,
  currentActorId,
  onExternalEvents,
}: UseActivityEventsOptions) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestEvent, setLatestEvent] = useState<ActivityEvent | null>(null);
  const pollStateRef = useRef<ActivityPollState>(initialActivityPollState);
  const pollingRef = useRef(false);
  const onExternalEventsRef = useRef(onExternalEvents);

  useEffect(() => {
    onExternalEventsRef.current = onExternalEvents;
  }, [onExternalEvents]);

  useEffect(() => {
    if (!authenticated) {
      pollStateRef.current = initialActivityPollState;
      setUnreadCount(0);
      setLatestEvent(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (document.hidden || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const response = await listActivityEvents(pollStateRef.current.since);
        if (cancelled) return;
        const { state, notify } = advanceActivityPoll(pollStateRef.current, response.rows);
        pollStateRef.current = state;
        if (notify.length === 0) return;
        const externalEvents = currentActorId
          ? notify.filter((event) => event.actor_id !== currentActorId)
          : [...notify];
        if (externalEvents.length === 0) return;
        const latest = externalEvents[externalEvents.length - 1];
        setLatestEvent(latest);
        setUnreadCount((current) => current + externalEvents.length);
        onExternalEventsRef.current(externalEvents);
      } catch {
        // Background refresh must not interrupt the active workspace.
      } finally {
        pollingRef.current = false;
      }
    };
    const onVisibilityChange = () => {
      if (!document.hidden) void poll();
    };

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [authenticated, currentActorId]);

  const markEventsSeen = () => setUnreadCount(0);
  return { unreadCount, latestEvent, markEventsSeen };
}
