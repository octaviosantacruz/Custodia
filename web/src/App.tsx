import { useEffect } from 'react';
import { Login } from './pages/login.tsx';
import { Overview } from './pages/overview.tsx';
import { People } from './pages/people.tsx';
import { Person } from './pages/person.tsx';
import { Sources } from './pages/sources.tsx';
import { Accounts, Identities, NetskopeDevices, NetskopeUsers, NetskopeVersions, Platforms, Roles, Safes } from './pages/tools.tsx';
import { System } from './pages/system.tsx';
import { navigate, useApp, useLocation } from './ui/router.tsx';
import { Shell } from './ui/shell.tsx';

const TITLES: Record<string, string> = {
  '/': 'Resumen', '/personas': 'Personas', '/fuentes': 'Fuentes', '/sistema': 'Sistema visual', '/entrar': 'Entrar',
  '/cyberark/identidades': 'Identidades · CyberArk', '/cyberark/roles': 'Roles · CyberArk', '/cyberark/safes': 'Safes · CyberArk',
  '/cyberark/cuentas': 'Cuentas · CyberArk', '/cyberark/plataformas': 'Plataformas · CyberArk',
  '/netskope/usuarios': 'Usuarios · Netskope', '/netskope/equipos': 'Equipos · Netskope', '/netskope/versiones': 'Versiones · Netskope',
};

export function App() {
  const { path } = useLocation();
  const { signedIn } = useApp();
  const needsLogin = !signedIn && path !== '/entrar';

  // Un enlace profundo (por ejemplo desde el sitio) pasa por la entrada y vuelve.
  useEffect(() => { if (needsLogin) navigate(path === '/' ? '/entrar' : `/entrar?volver=${encodeURIComponent(path)}`); }, [needsLogin, path]);
  useEffect(() => {
    document.title = `${TITLES[path] ?? 'Persona'} · Custodia`;
    window.scrollTo(0, 0);
    document.getElementById('contenido')?.focus({ preventScroll: true });
  }, [path]);

  if (needsLogin) return null;
  if (path === '/entrar') return <Login />;
  if (path === '/') return <Overview />;
  if (path === '/personas') return <People />;
  const person = path.match(/^\/personas\/(\d+)$/);
  if (person) return <Person id={Number(person[1])} />;
  if (path === '/cyberark/identidades') return <Identities />;
  if (path === '/cyberark/roles') return <Roles />;
  if (path === '/cyberark/safes') return <Safes />;
  if (path === '/cyberark/cuentas') return <Accounts />;
  if (path === '/cyberark/plataformas') return <Platforms />;
  if (path === '/netskope/usuarios') return <NetskopeUsers />;
  if (path === '/netskope/equipos') return <NetskopeDevices />;
  if (path === '/netskope/versiones') return <NetskopeVersions />;
  if (path === '/fuentes') return <Sources />;
  if (path === '/sistema') return <System />;
  return <Shell title="No encontrado"><p>Esta página no existe en la demo.</p></Shell>;
}
