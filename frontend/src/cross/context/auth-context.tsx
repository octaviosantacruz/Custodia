import { createContext, useContext, type ReactNode } from 'react';
import type { AuthStatus } from '../types/auth';

/* Scoped to the header/profile surface only (AppHeader -> ProfileMenu).
   Workspaces keep receiving authChecked/authenticated/permissions as
   explicit props from App.tsx -- this context does not reach that far. */
type AuthContextValue = {
  authStatus: AuthStatus;
  onLoggedOut: () => void;
  onProfileUpdated: (name: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ value, children }: { value: AuthContextValue; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext must be used within an AuthProvider');
  return context;
}
