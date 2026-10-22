import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// `ComponentType<never>`/`<unknown>` reject components with required props, so
// the helper mirrors React.lazy's own permissive signature.
type Importer<T extends ComponentType<any>> = () => Promise<{ default: T }>;

/** Reloads once when a deployed code split is stale, then surfaces the error. */
export function lazyWithRetry<T extends ComponentType<any>>(importer: Importer<T>, retryKey: string): LazyExoticComponent<T> {
  return lazy(() => {
    const storageKey = `custodia:chunk-retry:${retryKey}`;
    const storage = typeof window === 'undefined' ? null : window.sessionStorage;
    return importer()
      .then((module) => {
        storage?.removeItem(storageKey);
        return module;
      })
      .catch((error) => {
        if (!storage || storage.getItem(storageKey) === '1') {
          storage?.removeItem(storageKey);
          throw error;
        }
        storage.setItem(storageKey, '1');
        window.location.reload();
        return new Promise<never>(() => undefined);
      });
  });
}
