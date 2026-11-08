import { useEffect, useRef, useState } from 'react';

/** Which element should receive focus when a popover closes: the one that had
 *  focus before opening, or the declared fallback when that node is gone.
 *  Pure on purpose so the decision is unit-testable without a DOM. */
export function focusRestoreTarget(
  previouslyFocused: HTMLElement | null,
  fallback: HTMLElement | null | undefined,
): HTMLElement | null {
  if (previouslyFocused?.isConnected) return previouslyFocused;
  return fallback?.isConnected ? fallback : null;
}

type UsePopoverOptions = {
  /** Focus target used when the element focused before opening is gone by the
   *  time the popover closes (e.g. a menu item replaced the trigger). */
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
};

export function usePopover<T extends HTMLElement = HTMLDivElement>({ fallbackFocusRef }: UsePopoverOptions = {}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const restoreOnClose = useRef(false);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        // The click already moved focus to its own target; never steal it back.
        restoreOnClose.current = false;
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        restoreOnClose.current = true;
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  // UX-AUD-004: Escape closes the popover from within and returns focus to the
  // element that opened it, with a fallback when that node is disconnected.
  useEffect(() => {
    if (open || !restoreOnClose.current) return;
    restoreOnClose.current = false;
    focusRestoreTarget(previouslyFocused.current, fallbackFocusRef?.current)?.focus();
  }, [fallbackFocusRef, open]);

  return { open, setOpen, ref };
}
