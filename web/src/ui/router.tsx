import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import type { SourceMode } from '../model/company.ts';

/* ---------- Ruta: hash, sin dependencias ----------
   La demo vive en /demo/ de un sitio estático: el servidor no reescribe rutas
   profundas, así que la ruta va en el hash (#/personas/3) y cualquier enlace
   o recarga llega a la misma página. */

const current = () => window.location.hash.replace(/^#/, '') || '/';

export function navigate(to: string) {
  if (to === current()) return;
  window.location.hash = to;
  window.scrollTo(0, 0);
}

export function useLocation() {
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const update = () => setLocation(current());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const url = new URL(location, 'https://demo.invalid');
  return { path: url.pathname.replace(/\/+$/, '') || '/', params: url.searchParams };
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (to === current()) event.preventDefault();
  };
  return <a href={`#${to}`} onClick={onClick} {...rest}>{children}</a>;
}

/* ---------- Sesión de demo y escenario de captura ---------- */

const read = (key: string) => { try { return window.sessionStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => {
  try { if (value === null) window.sessionStorage.removeItem(key); else window.sessionStorage.setItem(key, value); } catch { /* sólo esta pestaña */ }
};

type AppState = { signedIn: boolean; signIn: () => void; signOut: () => void; mode: SourceMode; setMode: (mode: SourceMode) => void };
const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(() => read('custodia-session') === 'demo');
  const [mode, setModeState] = useState<SourceMode>(() => {
    const stored = read('custodia-capture');
    return stored === 'stale' || stored === 'partial' ? stored : 'complete';
  });
  const state: AppState = {
    signedIn,
    signIn: () => { write('custodia-session', 'demo'); setSignedIn(true); },
    signOut: () => { write('custodia-session', null); setSignedIn(false); },
    mode,
    setMode: (next) => { write('custodia-capture', next); setModeState(next); },
  };
  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

export function useApp() {
  const state = useContext(AppContext);
  if (!state) throw new Error('useApp fuera de AppProvider');
  return state;
}
