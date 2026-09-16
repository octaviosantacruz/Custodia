import type { ReactNode } from 'react';
import {
  Activity, Boxes, Database, FileLock2, Fingerprint, History, KeyRound, LayoutGrid, Link2, Network, PlugZap, SearchCode, Server, ShieldAlert, ShieldCheck, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import type { WorkspaceView } from './workspaces';

/* Single source of truth for how a workspace presents itself in
   navigation surfaces (workspace switcher, command center, global search,
   the top bar breadcrumb). Previously this label/detail pair was defined
   twice (workspaces.ts and workspace-switcher.tsx) and had to be kept in
   sync by hand. */
export const WORKSPACE_ICONS: Record<WorkspaceView, LucideIcon> = {
  general: LayoutGrid,
  posture: ShieldAlert,
  graph: Network,
  safes: Database,
  roles: Users,
  platforms: Server,
  connectors: PlugZap,
  identityUsers: Users,
  identityGroups: Users,
  identityRoles: KeyRound,
  identity: UserCog,
  sia: PlugZap,
  assets: SearchCode,
  users: Users,
  activity: History,
  pamHealth: Activity,
  aimApplications: ShieldCheck,
  accessAssets: Fingerprint,
  siaConnectors: PlugZap,
  siaResources: Boxes,
  siaDatabaseAccounts: Database,
  identityFederations: Link2,
  netskope: FileLock2,
};

export const WORKSPACE_META: Record<WorkspaceView, { label: string; detail: string; icon: ReactNode }> = {
  general: { label: 'Métricas', detail: 'Cobertura y decisiones pendientes', icon: <LayoutGrid size={16} /> },
  posture: { label: 'Postura', detail: 'Hallazgos y evidencia accionable', icon: <ShieldAlert size={16} /> },
  graph: { label: 'Cadenas', detail: 'Explorador visual de acceso PAM', icon: <Network size={16} /> },
  safes: { label: 'Safes', detail: 'Inventario y miembros', icon: <Database size={16} /> },
  roles: { label: 'Roles CyberArk', detail: 'Roles nativos y alcance', icon: <Users size={16} /> },
  platforms: { label: 'Plataformas', detail: 'Safes y cuentas por plataforma', icon: <Server size={16} /> },
  connectors: { label: 'Conectores PSM y SIA', detail: 'Inventarios PSM y SIA en un único workspace', icon: <PlugZap size={16} /> },
  identityUsers: { label: 'Usuarios PAM', detail: 'Identidades reconocidas', icon: <Users size={16} /> },
  identityGroups: { label: 'Grupos Okta', detail: 'Grupos federados', icon: <Users size={16} /> },
  identityRoles: { label: 'Roles Identity', detail: 'Roles de Identity Administration', icon: <KeyRound size={16} /> },
  identity: { label: 'Identidades', detail: 'Directorio SCIM de Identity Administration', icon: <UserCog size={16} /> },
  sia: { label: 'SIA', detail: 'Políticas, recursos y cobertura', icon: <PlugZap size={16} /> },
  assets: { label: 'Activos y conexiones', detail: 'Cobertura de conexiones importadas', icon: <SearchCode size={16} /> },
  users: { label: 'Acceso', detail: 'Usuarios de la plataforma', icon: <Users size={16} /> },
  activity: { label: 'Actividad', detail: 'Bitácora administrativa', icon: <History size={16} /> },
  pamHealth: { label: 'Salud PAM', detail: 'Conectividad de Portal, CPM y PSM', icon: <Activity size={16} /> },
  aimApplications: { label: 'Aplicaciones AIM', detail: 'Catálogo de Application Identity Manager', icon: <ShieldCheck size={16} /> },
  accessAssets: { label: 'Assets de Access', detail: 'Catálogo del Access space', icon: <Fingerprint size={16} /> },
  // 'siaConnectors' is a compatibility-only key: SIA connectors now live
  // inside the unified 'connectors' workspace (PSM/SIA section toggle),
  // never rendered as its own switcher entry (see domains.ts, which
  // excludes it from every domain's available views). This entry only
  // exists so Record<WorkspaceView, ...> stays exhaustive and, if ever
  // reached anyway (e.g. a stale saved preference), shows accurate info
  // instead of describing a workspace that no longer exists.
  siaConnectors: { label: 'Conectores PSM y SIA', detail: 'Inventarios PSM y SIA en un único workspace', icon: <PlugZap size={16} /> },
  siaResources: { label: 'Recursos SIA', detail: 'Infraestructura VM de Secure Infrastructure Access', icon: <Boxes size={16} /> },
  siaDatabaseAccounts: { label: 'Cuentas fuertes de BD SIA', detail: 'Strong Accounts de base de datos de Secure Infrastructure Access', icon: <Database size={16} /> },
  identityFederations: { label: 'Federaciones', detail: 'Federaciones de Identity Administration', icon: <Link2 size={16} /> },
  netskope: { label: 'Netskope DLP', detail: 'Preparación de la fuente DLP', icon: <FileLock2 size={16} /> },
};

export const workspaceLabels: Record<WorkspaceView, string> = Object.fromEntries(
  (Object.keys(WORKSPACE_META) as WorkspaceView[]).map((view) => [view, WORKSPACE_META[view].label]),
) as Record<WorkspaceView, string>;
