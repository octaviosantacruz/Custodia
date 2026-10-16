import { useCallback, useEffect, useRef, useState } from 'react';
import { loadWidgetCommandSources } from '../../sources.ts';
import {
  widgetCommands,
  type CommandCenterCommand, type WidgetCommandSources,
} from '../lib/command-center';

export type WidgetCommandsStatus = 'idle' | 'loading' | 'ready' | 'error';

/* Bundle-size follow-up to UX-SEARCH-001: the PAM/Netskope widget catalogs
   are no longer part of the entry bundle (command-center.ts only imports
   their types). This hook is GlobalSearch's loader: it fetches both in
   parallel with `loadWidgetCommandSources()` only while `active` (the
   Command-K dialog being open, or a caller preloading ahead of that), caches
   the in-flight/resolved promise in a ref so a hover/focus preload and the
   dialog actually opening never issue a second import(), and ignores a
   resolution that lands after `active` went back to false -- the same
   late-result guard GlobalSearch already applies to its remote inventory
   search. Kept in its own `.ts` module (no JSX) so it's testable under
   plain `node --test`, which cannot load a `.tsx` file. */
export function useWidgetCommands(permissions: string[], active: boolean) {
  const [sources, setSources] = useState<WidgetCommandSources | null>(null);
  const [status, setStatus] = useState<WidgetCommandsStatus>('idle');
  const promiseRef = useRef<Promise<WidgetCommandSources> | null>(null);

  const ensureLoaded = useCallback((): Promise<WidgetCommandSources> => {
    if (!promiseRef.current) {
      setStatus((current) => (current === 'ready' ? current : 'loading'));
      promiseRef.current = loadWidgetCommandSources().catch((error: unknown) => {
        promiseRef.current = null;
        throw error;
      });
    }
    return promiseRef.current;
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    ensureLoaded()
      .then((loaded) => {
        if (cancelled) return;
        setSources(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [active, ensureLoaded]);

  const commands: CommandCenterCommand[] = sources ? widgetCommands(permissions, sources) : [];
  return { commands, status, ensureLoaded };
}
