/* FE-MOTION-001 (phase 1): TS mirror of the CSS tokens in styles/motion.css.
   The unit test motion-tokens.unit.test.ts parses that file and fails if both
   sides drift, so the fixed values are declared once per runtime instead of
   reading getComputedStyle at call time. */

export const MOTION_FAST_MS = 140;
export const MOTION_BASE_MS = 190;
export const MOTION_PANEL_MS = 210;

/** Reads the user preference at call time (no listener, no per-render work).
    Runtime changes to the OS setting are honored on the next decision point,
    which is enough for entrance/exit timing. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Overlay exit duration: zero under reduced motion so the portal unmounts
    without a perceptible wait (usePresence supports a zero duration). */
export function overlayExitMs(): number {
  return prefersReducedMotion() ? 0 : MOTION_PANEL_MS;
}
