import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, logout } from '../lib/api';
import { passwordRequirements } from '../lib/password-policy';
import type { AuthStatus } from '../types/auth';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

export const passwordChecks = passwordRequirements;

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

  const loadAuthStatus = useCallback(async (signal?: AbortSignal) => {
    setAuthChecked(false);
    setAuthError('');
    try {
      const status = await api<AuthStatus>('/auth/status', { signal });
      setAuthStatus(status);
      setAuthChecked(true);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setAuthStatus(null);
      setAuthError(error instanceof Error ? error.message : 'No se pudo comprobar la sesión');
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
        ? 'Se cerró la sesión por inactividad.'
        : 'La sesión local se cerró, pero no se pudo confirmar el cierre en el servidor.');
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
    if (loginPassword !== registerPasswordConfirm) {
      onError('Las contraseñas no coinciden');
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
      setAuthMessage('Cuenta creada. Ahora iniciá sesión para continuar.');
      setAuthStatus(await api<AuthStatus>('/auth/status'));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo crear la cuenta');
    } finally {
      setRegisterBusy(false);
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    onError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: loginEmail, password: loginPassword }) });
      setLoginPassword('');
      setAuthStatus(await api<AuthStatus>('/auth/status'));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo iniciar sesión');
    } finally {
      setLoginBusy(false);
    }
  };

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    const checks = passwordChecks(newPassword);
    if (!checks.every((check) => check.valid)) {
      onError('La nueva contraseña no cumple todas las condiciones.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      onError('Las contraseñas nuevas no coinciden.');
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
      onNotice('Contraseña actualizada. Ya podés ingresar al inventario.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo actualizar la contraseña');
    } finally {
      setPasswordChangeBusy(false);
    }
  };

  return {
    authStatus, setAuthStatus, authChecked,
    authError, retryAuth: () => void loadAuthStatus(),
    loginEmail, setLoginEmail, loginPassword, setLoginPassword, loginBusy,
    passwordChangeBusy, currentPassword, setCurrentPassword, newPassword, setNewPassword,
    newPasswordConfirm, setNewPasswordConfirm, showRegistration, setShowRegistration,
    registerName, setRegisterName, registerPasswordConfirm, setRegisterPasswordConfirm,
    registerBusy, setupStep, setSetupStep, authMessage, submitRegistration, submitLogin,
    submitPasswordChange,
  };
}

export type UseAuthState = ReturnType<typeof useAuth>;
