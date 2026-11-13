import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, logout } from '../lib/api';
import { errorDetailsFrom, type ErrorDetails } from '../lib/error-details';
import { passwordRequirements } from '../lib/password-policy';
import type { AuthStatus } from '../types/auth';
import { t } from '../i18n/index.ts';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

export const passwordChecks = passwordRequirements;
/** AUTH-AGENT-001: local sign-in page when Okta is the main login (hybrid). */
export const LOCAL_LOGIN_PATH = '/login/local';

type UseAuthOptions = {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onSessionExpired: () => void;
};

export function useAuth({ onError, onNotice, onSessionExpired }: UseAuthOptions) {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [showRegistration, setShowRegistration] = useState(false);
  const [registerName, setRegisterName] = useState('');
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authErrorDetails, setAuthErrorDetails] = useState<ErrorDetails | null>(null);

  const loadAuthStatus = useCallback(async (signal?: AbortSignal) => {
    setAuthChecked(false);
    setAuthError('');
    setAuthErrorDetails(null);
    try {
      const status = await api<AuthStatus>('/auth/status', { signal });
      setAuthStatus(status);
      setAuthChecked(true);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setAuthStatus(null);
      setAuthError(error instanceof Error ? error.message : t('No se pudo comprobar la sesión'));
      setAuthErrorDetails(errorDetailsFrom(error, t('No se pudo comprobar la sesión')));
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAuthStatus(controller.signal);
    return () => controller.abort();
  }, [loadAuthStatus]);

  useEffect(() => {
    if (!authStatus?.authenticated) return;
    let timeoutId: number;
    const handleIdle = async () => {
      const loggedOut = await logout();
      setAuthStatus((current) => current ? { ...current, authenticated: false, user: null } : current);
      setAuthMessage(loggedOut
        ? t('Tu sesión venció por inactividad. Volvé a entrar.')
        : t('La sesión local se cerró, pero no se pudo confirmar el cierre en el servidor.'));
      onSessionExpired();
    };
    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(handleIdle, IDLE_TIMEOUT_MS);
    };
    IDLE_ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      window.clearTimeout(timeoutId);
      IDLE_ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [authStatus?.authenticated, onSessionExpired]);

  const submitRegistration = async (event: FormEvent) => {
    event.preventDefault();
    if (!registerName.trim() || !loginEmail.trim()) {
      onError(t('Completá tu nombre y tu email.'));
      return;
    }
    if (!loginPassword) {
      onError(t('Elegí una contraseña.'));
      return;
    }
    if (loginPassword !== registerPasswordConfirm) {
      onError(t('Las contraseñas no coinciden'));
      return;
    }
    setRegisterBusy(true);
    onError('');
    try {
      await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: loginEmail, password: loginPassword, display_name: registerName }) });
      setLoginPassword('');
      setRegisterPasswordConfirm('');
      setShowRegistration(false);
      setSetupStep(1);
      setAuthMessage(t('Cuenta creada. Ahora iniciá sesión para continuar.'));
      setAuthStatus(await api<AuthStatus>('/auth/status'));
    } catch (error) {
      onError(error instanceof Error ? error.message : t('No se pudo crear la cuenta'));
    } finally {
      setRegisterBusy(false);
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      onError(t('Completá email y contraseña.'));
      return;
    }
    setLoginBusy(true);
    onError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: loginEmail, password: loginPassword }) });
      setLoginPassword('');
      if (window.location.pathname === LOCAL_LOGIN_PATH) {
        window.history.replaceState(null, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      setAuthStatus(await api<AuthStatus>('/auth/status'));
    } catch (error) {
      onError(error instanceof Error ? error.message : t('No se pudo iniciar sesión'));
    } finally {
      setLoginBusy(false);
    }
  };

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      onError(t('Completá tu contraseña actual y la nueva.'));
      return;
    }
    const checks = passwordChecks(newPassword);
    if (!checks.every((check) => check.valid)) {
      onError(t('La nueva contraseña no cumple todas las condiciones.'));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      onError(t('Las contraseñas nuevas no coinciden.'));
      return;
    }
    setPasswordChangeBusy(true);
    onError('');
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setAuthStatus(await api<AuthStatus>('/auth/status'));
      onNotice(t('Contraseña actualizada. Ya podés ingresar al inventario.'));
    } catch (error) {
      onError(error instanceof Error ? error.message : t('No se pudo actualizar la contraseña'));
    } finally {
      setPasswordChangeBusy(false);
    }
  };

  return {
    authStatus, setAuthStatus, authChecked,
    authError, authErrorDetails, retryAuth: () => void loadAuthStatus(),
    loginEmail, setLoginEmail, loginPassword, setLoginPassword, loginBusy,
    passwordChangeBusy, currentPassword, setCurrentPassword, newPassword, setNewPassword,
    newPasswordConfirm, setNewPasswordConfirm, showRegistration, setShowRegistration,
    registerName, setRegisterName, registerPasswordConfirm, setRegisterPasswordConfirm,
    registerBusy, setupStep, setSetupStep, authMessage, submitRegistration, submitLogin,
    submitPasswordChange,
  };
}

export type UseAuthState = ReturnType<typeof useAuth>;
