import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

type UseDialogFocusTrapOptions = {
  /** Whether the trap is currently engaged. Defaults to true -- pass false
   *  only if the same component renders the dialog markup without actually
   *  showing it (most call sites instead mount/unmount conditionally, which
   *  the effect's cleanup already handles). */
  active?: boolean;
  /** Called when Escape is pressed while focus is inside the dialog. */
  onClose?: () => void;
  /** Focus this element first instead of the first focusable descendant
   *  (e.g. a drawer's close button, so it mirrors the existing
   *  safe-detail-drawer.tsx behavior). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

/**
 * Shared modal/drawer accessibility primitive: moves focus inside the
 * dialog when it mounts, keeps Tab/Shift+Tab cycling within its focusable
 * descendants instead of leaking into the page behind the backdrop, closes
 * on Escape when `onClose` is given, and restores focus to whatever
 * triggered the dialog once it unmounts.
 *
 * Attach the returned ref to the dialog's outer `role="dialog"` /
 * `role="alertdialog"` element.
 */
export function useDialogFocusTrap<T extends HTMLElement>({
  active = true,
  onClose,
  initialFocusRef,
}: UseDialogFocusTrapOptions = {}) {
  const containerRef = useRef<T>(null);
  // Callers typically pass an inline arrow function for `onClose`, which is
  // a new reference on every render. Keeping it in a ref (rather than the
  // effect's dependency array) means an unrelated parent re-render never
  // tears the trap down and re-focuses the dialog's first element, which
  // would otherwise steal focus back from whatever the user just moved to
  // (e.g. a second dialog opened on top of this one).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableElements = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    const initial = initialFocusRef?.current ?? focusableElements()[0] ?? container;
    initial.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onCloseRef.current) {
        event.preventDefault();
        // A dialog can be nested inside another (e.g. a delete-confirmation
        // ConfirmDialog rendered inside dashboard-customizer.tsx's own
        // drawer, unlike user-admin.tsx's confirm dialogs which are JSX
        // siblings of their drawer). Without stopping propagation, Escape
        // would keep bubbling past this container into the parent dialog's
        // own keydown listener and close both instead of just this one.
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableElements();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        event.stopPropagation();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        event.stopPropagation();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initialFocusRef]);

  return containerRef;
}
