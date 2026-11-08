import { useEffect, useState } from 'react';
import { fetchSyncTaskSchedules } from '../lib/ingestion-api';
import type { SyncTaskSchedule } from '../types/ingestion';

const REFRESH_MS = 60_000;

/** Task schedules polled at a low cadence for the stale-data banner. A failed
 *  read keeps the last known rows: no evidence is never turned into a warning. */
export function useSyncFreshness(enabled: boolean): SyncTaskSchedule[] {
  const [rows, setRows] = useState<SyncTaskSchedule[]>([]);
  useEffect(() => {
    if (!enabled) { setRows([]); return undefined; }
    const controller = new AbortController();
    const load = () => { fetchSyncTaskSchedules(controller.signal).then((next) => { if (!controller.signal.aborted) setRows(next); }).catch(() => undefined); };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [enabled]);
  return rows;
}
