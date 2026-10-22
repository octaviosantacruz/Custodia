import { createContext, useContext } from 'react';

export const PamRefreshContext = createContext(0);

export function usePamRefreshKey(): number {
  return useContext(PamRefreshContext);
}
