import { useEffect } from 'react';

/** Warn before losing unsaved in-place dashboard edits on tab close/reload.
 * In-app navigation is guarded by each editor's own discard confirmation. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
