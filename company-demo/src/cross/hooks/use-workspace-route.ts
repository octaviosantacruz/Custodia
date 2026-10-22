import { useCallback, useEffect, useState } from 'react';
import { workspaceFromPath, workspacePath, type WorkspaceView } from '../lib/workspaces';
import { LOCAL_LOGIN_PATH } from './use-auth';

function initialWorkspace(): WorkspaceView {
  if (typeof window === 'undefined') return 'general';
  return workspaceFromPath(window.location.pathname) || 'general';
}

export function useWorkspaceRoute() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(initialWorkspace);
  const [pathname, setPathname] = useState(() => typeof window === 'undefined' ? '/' : window.location.pathname);
  const isHome = pathname === '/';

  useEffect(() => {
    const handlePopState = () => {
      setPathname(window.location.pathname);
      setWorkspaceView(workspaceFromPath(window.location.pathname) || 'general');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const urlWorkspace = workspaceFromPath(window.location.pathname) || 'general';
    if (urlWorkspace !== workspaceView) {
      setWorkspaceView(urlWorkspace);
      return;
    }
    // AUTH-AGENT-001: the local sign-in page is not a workspace URL to canonicalize.
    if (window.location.pathname === '/' || window.location.pathname === LOCAL_LOGIN_PATH) return;
    const canonicalPath = workspacePath(workspaceView);
    if (window.location.pathname === canonicalPath) return;
    window.history.replaceState({ workspace: workspaceView }, '', canonicalPath + window.location.search + window.location.hash);
  }, [workspaceView]);

  const navigateWorkspace = useCallback((nextView: WorkspaceView, options?: { replace?: boolean }) => {
    const nextPath = workspacePath(nextView);
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      const method = options?.replace ? 'replaceState' : 'pushState';
      window.history[method]({ workspace: nextView }, '', nextPath);
      setPathname(nextPath);
    }
    setWorkspaceView(nextView);
  }, []);

  useEffect(() => {
    if (workspaceView !== 'identity' || isHome) return;
    const legacySection = new URLSearchParams(window.location.search).get('section');
    navigateWorkspace(legacySection === 'roles' || legacySection === 'groups' ? 'identityRoles' : 'identityUsers', { replace: true });
  }, [isHome, navigateWorkspace, workspaceView]);

  const navigateHome = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState({ workspace: 'general' }, '', '/');
      setPathname('/');
    }
    setWorkspaceView('general');
  }, []);

  return { workspaceView, navigateWorkspace, navigateHome, isHome };
}
