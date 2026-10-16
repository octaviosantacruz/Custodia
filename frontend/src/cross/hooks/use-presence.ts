import { useEffect, useState } from 'react';

/* Keeps the last truthy value mounted for `exitMs` after it is cleared, so a
   toast can play its exit animation instead of vanishing on unmount. */
export function usePresence<T>(value: T | null | undefined, exitMs: number): { current: T | null; leaving: boolean } {
  const [last, setLast] = useState<T | null>(value || null);
  if (value && value !== last) setLast(value);

  useEffect(() => {
    if (value || last === null) return;
    /* FE-MOTION-001: a zero duration means "nothing to wait for" (reduced
       motion): clear the retained value in this effect instead of scheduling a
       0ms timer. Positive durations keep the toast exit window intact. */
    if (exitMs <= 0) {
      setLast(null);
      return;
    }
    const timeout = window.setTimeout(() => setLast(null), exitMs);
    return () => window.clearTimeout(timeout);
  }, [value, last, exitMs]);

  return { current: value || last, leaving: !value && last !== null };
}
