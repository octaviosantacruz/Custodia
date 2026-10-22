import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MOTION_BASE_MS } from '../lib/motion';
import type { WorkspaceView } from '../lib/workspaces';

/** FE-MOTION-001: restarts the content arrival animation only when the
    workspace really changes. The class is applied in a layout effect -- before
    the browser paints -- so the first painted frame of the new workspace
    already carries it (never a full-opacity paint followed by a fade from
    zero). The new workspace renders immediately: the class is presentation
    only, never a gate for Suspense, loaders or data, and internal refreshes,
    filters, notifications or data updates inside the same workspace never
    replay it. Alternating `a`/`b` lets a back-to-back navigation restart the
    CSS animation without remounting the router (a `key` would refetch or lose
    per-workspace state). Returns the extra class names for the content layer,
    or an empty string when idle. */
export function useWorkspaceTransition(workspaceView: WorkspaceView): string {
  const previous = useRef(workspaceView);
  const [arrival, setArrival] = useState<{ id: number; active: boolean }>({ id: 0, active: false });

  useLayoutEffect(() => {
    if (previous.current === workspaceView) return;
    previous.current = workspaceView;
    setArrival((current) => ({ id: current.id + 1, active: true }));
  }, [workspaceView]);

  useEffect(() => {
    if (!arrival.active) return undefined;
    const timeout = window.setTimeout(() => {
      setArrival((current) => ({ ...current, active: false }));
    }, MOTION_BASE_MS);
    return () => window.clearTimeout(timeout);
  }, [arrival.id, arrival.active]);

  if (!arrival.active) return '';
  return arrival.id % 2 === 1 ? ' is-arriving-a' : ' is-arriving-b';
}
