import { AlertCircle, Check, KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { passwordChecks, type UseAuthState } from '../hooks/use-auth';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import { DsHubMark } from './home-workspace';
import { RegistrationPasswordFields } from './registration-password-fields';

type AuthViewProps = {
  auth: UseAuthState;
  error: string;
};

export function AuthView({ auth, error }: AuthViewProps) {
  const [loginMethod, setLoginMethod] = useState<'local' | 'oidc'>('local');
  const {
    authStatus, authChecked, loginEmail, setLoginEmail, loginPassword, setLoginPassword, loginBusy,
    passwordChangeBusy, currentPassword, setCurrentPassword, newPassword, setNewPassword,
    newPasswordConfirm, setNewPasswordConfirm, showRegistration, setShowRegistration, registerName,
    setRegisterName, registerPasswordConfirm, setRegisterPasswordConfirm, registerBusy, setupStep,
    setSetupStep, authMessage, authError, retryAuth, submitRegistration, submitLogin, submitPasswordChange,
  } = auth;
  if (!authChecked) return <main className="auth-shell auth-state-shell"><section className="auth-card auth-state-card" role="status" aria-live="polite"><div className="auth-gate-mark"><DsHubMark /></div><h1>Comprobando tu acceso</h1><p>Estamos verificando la sesión antes de cargar DS Hub.</p></section></main>;
  if (authError) return <main className="auth-shell auth-state-shell"><section className="auth-card auth-state-card" role="alert"><div className="auth-gate-mark"><AlertCircle size={22} /></div><h1>No se pudo comprobar la sesión</h1><p>{authError}</p><button className="button primary auth-submit" type="button" onClick={retryAuth}>Reintentar</button></section></main>;
  if (!authStatus) return null;
  if (!authStatus.authenticated) {
    const setupAvailable = (authStatus.mode === 'local' || authStatus.mode === 'hybrid') && authStatus.setup_available;
    const checks = passwordChecks(loginPassword);
    const passwordScore = checks.filter((check) => check.valid).length;
    const canContinue = loginEmail.trim().length > 0 && registerName.trim().length > 0;
    const canCreate = passwordScore === checks.length && loginPassword === registerPasswordConfirm;
    const localLoginAvailable = authStatus.mode === 'local' || authStatus.mode === 'hybrid';
    const oidcLoginAvailable = authStatus.mode === 'oidc' || authStatus.mode === 'hybrid';
    const selectedLoginMethod = authStatus.mode === 'oidc' ? 'oidc' : loginMethod;
    const submitOidcLogin = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = loginEmail.trim();
      window.location.assign('/api/auth/oidc/login' + (email ? '?email=' + encodeURIComponent(email) : ''));
    };

    return <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-logo"><DsHubMark /></div>
        <p className="eyebrow">DS HUB</p>
        <h1>{setupAvailable ? 'Empecemos por tu cuenta.' : 'Bienvenido a DS Hub.'}</h1>
        <p>{setupAvailable ? 'Creá el primer acceso administrador para comenzar a trabajar con el inventario.' : 'Un acceso claro para revisar y gobernar tus identidades privilegiadas.'}</p>
        <span className="auth-brand-line" />
      </section>
      <section className="auth-card">
        {setupAvailable && !showRegistration ? <div className="auth-welcome"><div className="auth-step-marker">01</div><h2>Bienvenido</h2><p>Vamos a crear la cuenta inicial. Vas a usarla para ingresar y administrar el sistema.</p><button className="button primary auth-submit" type="button" onClick={() => setShowRegistration(true)}>Crear cuenta</button></div> : <div className="auth-card-header"><div className="auth-gate-mark"><DsHubMark /></div><div><p className="auth-step-label">{setupAvailable ? 'PASO ' + setupStep + ' DE 2' : 'ACCESO'}</p><h2>{setupAvailable ? (setupStep === 1 ? 'Tus datos' : 'Elegí una contraseña') : 'Iniciar sesión'}</h2></div></div>}
        {setupAvailable && showRegistration && <form className="auth-form" onSubmit={(event) => { event.preventDefault(); if (setupStep === 1) { if (canContinue) setSetupStep(2); return; } void submitRegistration(event); }}>
          {setupStep === 1 ? <><label>Nombre<input value={registerName} onChange={(event) => setRegisterName(event.target.value)} autoComplete="name" placeholder="Cómo te llamamos" required /></label><label>Email<input type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="tu@email.com" required /></label><button className="button primary auth-submit" type="submit" disabled={!canContinue}>Continuar</button></> : <><RegistrationPasswordFields password={loginPassword} onPasswordChange={setLoginPassword} confirmation={registerPasswordConfirm} onConfirmationChange={setRegisterPasswordConfirm} /><button className="button primary auth-submit" type="submit" disabled={registerBusy || !canCreate}>{registerBusy ? 'Creando cuenta...' : 'Crear cuenta'}</button><button className="auth-link" type="button" onClick={() => setSetupStep(1)}>Volver</button></>}
        </form>}
        {!setupAvailable && <>
          {authStatus.mode === 'hybrid' && <>
            <p className="auth-mode-note">Modo híbrido · elegí cómo ingresar</p>
            <div className="auth-method-switch" role="tablist" aria-label="Método de acceso" onKeyDown={handleTablistKeyDown}>
            <button type="button" role="tab" aria-label="Acceso local" title="Ingresar con email y contraseña local" aria-selected={selectedLoginMethod === 'local'} tabIndex={selectedLoginMethod === 'local' ? 0 : -1} className={selectedLoginMethod === 'local' ? 'active' : ''} onClick={() => setLoginMethod('local')}><span className="auth-method-icon"><KeyRound size={15} /></span><span><strong>Acceso local</strong><small>Email y contraseña</small></span></button>
            <button type="button" role="tab" aria-label="Okta corporativo" title="Ingresar mediante la identidad corporativa" aria-selected={selectedLoginMethod === 'oidc'} tabIndex={selectedLoginMethod === 'oidc' ? 0 : -1} className={selectedLoginMethod === 'oidc' ? 'active' : ''} onClick={() => setLoginMethod('oidc')}><span className="auth-method-icon"><ShieldCheck size={15} /></span><span><strong>Okta corporativo</strong><small>Inicio con OIDC</small></span></button>
            </div>
          </>}
          {selectedLoginMethod === 'local' && localLoginAvailable && <form className="auth-form" onSubmit={submitLogin}><label>Email<input type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required /></label><label>Contraseña<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></label><button className="button primary auth-submit" type="submit" disabled={loginBusy}>{loginBusy ? 'Ingresando...' : 'Iniciar sesión'}</button></form>}
          {selectedLoginMethod === 'oidc' && oidcLoginAvailable && <form className="auth-form" onSubmit={submitOidcLogin}><label>Email corporativo<input type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="tu@empresa.com" required /></label><button className="button primary auth-submit" type="submit">Continuar con Okta</button><small className="auth-provider-hint">Te vamos a llevar a Okta para completar el acceso.</small></form>}
        </>}
        {authMessage && <div className="auth-message"><Check size={15} /> {authMessage}</div>}{error && <div className="auth-error"><AlertCircle size={15} /> {error}</div>}
      </section>
    </main>;
  }

  if (authStatus.authenticated && authStatus.user?.must_change_password) { const checks = passwordChecks(newPassword); return <main className="auth-shell"><section className="auth-brand-panel"><div className="auth-logo"><DsHubMark /></div><p className="eyebrow">DS HUB</p><h1>Terminemos de configurar tu acceso.</h1><p>Por seguridad, reemplazá la contraseña temporal antes de entrar al inventario.</p><span className="auth-brand-line" /></section><section className="auth-card"><div className="auth-card-header"><div className="auth-gate-mark"><DsHubMark /></div><div><p className="auth-step-label">PRIMER ACCESO</p><h2>Elegí tu contraseña</h2></div></div><form className="auth-form" onSubmit={submitPasswordChange}><label>Contraseña actual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>Nueva contraseña<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoFocus required /><div className="password-checks">{checks.map((check) => <span className={check.valid ? "valid" : ""} key={check.label}>{check.valid ? "✓" : "○"} {check.label}</span>)}</div></label><label>Confirmar contraseña<input type="password" autoComplete="new-password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} required /></label><button className="button primary auth-submit" type="submit" disabled={passwordChangeBusy}>{passwordChangeBusy ? "Guardando..." : "Guardar contraseña"}</button></form>{error && <div className="auth-error"><AlertCircle size={15} /> {error}</div>}</section></main>; }

  return null;
}
