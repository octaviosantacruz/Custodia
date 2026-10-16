import type { WorkspaceView } from './workspaces';

export type IdentityChainLink = { view: WorkspaceView; path: string };

/** Deep link to Relaciones at the PAM account of an Identity person. The person
 * and the account are one node there, so the link carries the PAM `object_id`
 * (the Identity drawer resolves it through the sanctioned link) in the same
 * `?type&id&dir` shape the other tool links use. */
export function identityChainLink(pamUserId: number): IdentityChainLink {
  return { view: 'graph', path: `/pam/graph?type=user&id=${pamUserId}&dir=forward` };
}

/** Navigate to Relaciones and attach the node to the entry the navigation just
 * created. Mirrors PersonChainsWorkspace's openTool: the route only updates the
 * pathname, and the workspace reads the query on mount. If the navigation did
 * not happen (e.g. the actor lacks the permission), the URL is left alone. */
export function openIdentityChain(onNavigate: (view: WorkspaceView) => void, pamUserId: number): void {
  const link = identityChainLink(pamUserId);
  onNavigate(link.view);
  const target = new URL(link.path, window.location.origin);
  if (window.location.pathname === target.pathname) {
    window.history.replaceState(window.history.state, '', `${target.pathname}${target.search}`);
  }
}
