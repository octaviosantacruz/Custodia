import { useEffect, useState } from 'react';

/* Delays updating the returned value until `value` has been stable for
   `delayMs`. Used to avoid firing a network request on every keystroke in
   search inputs -- the input itself stays fully responsive (it's bound to
   the raw, undebounced state), only the value handed to a fetch effect is
   debounced. Mirrors the ad-hoc setTimeout already used by useDashboard
   (Safes) and GlobalSearch; extracted so every other search-driven hook
   can share the same behavior instead of firing a request per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
