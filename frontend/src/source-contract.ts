/**
 * Contratos TypeScript para registrar workspaces, permisos de navegación,
 * sincronizaciones y runtimes. La agrupación visual no cambia source_system;
 * los permisos del frontend deben acompañar las comprobaciones del servidor.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { WorkspaceView } from './cross/lib/workspace-catalog.ts';
import type { AuthStatus } from './cross/types/auth.ts';
import type { SearchResult } from './cross/lib/search-api.ts';
import type { IngestionRun } from './cross/types/ingestion.ts';

export type Domain = 'admin' | 'cross' | 'pam' | 'dlp' | 'dspm';

/* `open`: visible to any authenticated actor. `manage`: access:manage or the
   declared alternate permission. `strict`: only the declared permission --
   access:manage does NOT unlock it (NSK-DLP-001 segregation). */
export type WorkspaceGate = 'open' | 'manage' | 'strict';

export type WorkspaceIntroHelp = { label: string; paragraphs: readonly string[] };

export type WorkspaceCatalogEntry = {
  id: string;
  path: string;
  legacyPaths?: readonly string[];
  domain: Domain;
  label: string;
  detail: string;
  description: string;
  introHelp?: WorkspaceIntroHelp;
  icon: LucideIcon;
  catalog: boolean;
  switcher: boolean;
  gate: WorkspaceGate;
  alternatePermission?: string;
  /* Person view (CHAIN-010): reachable with any tool read permission, so the
     single `alternatePermission` slot is not enough. */
  alternatePermissions?: readonly string[];
  /* Permissions that unlock the view only together (CONN-001 reads two
     sources, so Identity and Netskope are both needed). */
  requiresAll?: readonly string[];
};

export type RegisteredWorkspace = WorkspaceCatalogEntry & {
  order: number;
  runtime: string;
  routingDomain?: Domain;
  category?: { id: string; order: number };
  recentWorkspace?: string;
  refreshSources?: readonly string[];
  command: { tool: string; platform: 'cyberark' | 'netskope' | 'custodia'; aliases: readonly string[]; priority: number };
};

export type SyncPresentation = { text: string; running: boolean; observedAt?: string | null };
export type SyncPresentationRegistration = {
  queryKey: readonly string[];
  readPermissions: readonly string[];
  fetch: (signal?: AbortSignal) => Promise<SyncPresentation>;
};

export type SourceMeta = { label: string; image?: string; fallback: string };
export type SyncRegistration = {
  source: string;
  meta: SourceMeta;
  domain: Domain;
  tool: string;
  toolMeta: SourceMeta;
  componentLabel: string;
  componentLabelsByFile?: Readonly<Record<string, string>>;
  sourceHints?: readonly string[];
  noticeHints?: readonly string[];
  hintOrder?: number;
  quietAutomaticSuccess?: boolean;
  presentation?: SyncPresentationRegistration;
};

/** Existing shell callbacks; routers accept only the subset they need. */
export type SourceRouterProps = {
  workspaceView: WorkspaceView;
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  authStatus: AuthStatus;
  permissions: string[];
  includeInternal: boolean;
  searchResult: SearchResult | null;
  onSearchHandled: () => void;
  catalogOpenRequest: number;
  onNavigate: (view: WorkspaceView) => void;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onDashboardLoad: (load: ((options?: { refreshStatic?: boolean }) => Promise<void>) | null) => void;
  onLatestRun: (run: IngestionRun | null) => void;
  authMode?: 'local' | 'oidc' | 'hybrid';
  currentActorId?: string;
  currentUserEmail?: string | null;
  apiDocsEnabled?: boolean;
  guideSection?: string | null;
};

export type ManualSyncAction = {
  domain: Domain;
  label: string;
  detail: string;
} & ({ kind: 'batch'; scope: 'all' | 'cyberark' } | {
  kind: 'direct';
  source: string;
  path: string;
  runningTitle: string;
  runningDetail: string;
  successTitle: string;
  successDetail: string;
  errorTitle: string;
  errorFallback: string;
});

export type RuntimeRegistration = {
  id: string;
  refreshDomain?: Domain;
  load: () => Promise<{ default: ComponentType<SourceRouterProps> }>;
  gateWorkspace: boolean;
  suspense: boolean;
  clearErrorOnNotice?: boolean;
};

export type DomainRegistration = {
  id: Domain;
  order: number;
  label: string;
  blurb: string;
  status: 'active' | 'coming-soon';
  access: 'workspaces' | 'domain';
  alternatePermissions?: readonly string[];
  /* A tool with few views shows them as a visible bar above the title instead
     of the header's view picker (UX-NAV-001). */
  sectionNav?: boolean;
  product: { id: string; label: string; description: string };
};

export type FrontendRegistration = {
  id: string;
  toolLabel?: string;
  workspaces: readonly RegisteredWorkspace[];
  domains: readonly DomainRegistration[];
  categories: readonly { id: string; label: string; order: number }[];
  sync?: SyncRegistration;
  runtime?: RuntimeRegistration;
  manualSync?: ManualSyncAction;
};
