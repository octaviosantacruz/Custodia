import { AlertCircle, Eye, EyeOff, Info } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { LOCAL_LOGIN_PATH, passwordChecks, type UseAuthState } from '../hooks/use-auth';
import { CustodiaMark } from './home-workspace';
import { ErrorDetailsButton } from './error-details';
import './auth-view.css';
import { t } from '../i18n/index.ts';

type AuthViewProps = {
  auth: UseAuthState;
  error: string;
};

/* Decorative night sky: a seeded starfield (stable between renders and
   screenshots) over a bridge between two node clusters, kept below the card. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const AUTH_STARS = (() => {
  const random = seededRandom(20261014);
  return Array.from({ length: 150 }, (_, index) => ({
    x: Math.round(random() * 1440), y: Math.round(random() * 640),
    r: +(0.5 + random() * 1.1).toFixed(2), opacity: +(0.18 + random() * 0.55).toFixed(2), twinkle: index % 11 === 0,
  }));
})();

/* The bridge: two small clusters of nodes (two isolated platforms) with one
   arc crossing the gap between them and a larger node at its apex (Custodia).
   Kept in the lower band, below the card. */
type AuthNode = [x: number, y: number, r: number];
const AUTH_CLUSTER_LEFT: AuthNode[] = [[170, 765, 4], [255, 717, 3], [300, 780, 5], [380, 735, 4], [430, 775, 7], [350, 825, 3]];
const AUTH_CLUSTER_RIGHT: AuthNode[] = [[1285, 750, 3], [1200, 727, 4], [1150, 787, 5], [1070, 723, 3], [1010, 775, 7], [1100, 820, 4]];
const AUTH_CLUSTER_EDGES: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 4], [2, 5], [4, 5]];
const AUTH_BRIDGE_NODE: AuthNode = [720, 700, 9];
const AUTH_BRIDGE_PATH = 'M430 775 C520 705 620 700 720 700 C820 700 920 705 1010 775';

function AuthCluster({ nodes }: { nodes: AuthNode[] }) {
  return <g>
    {AUTH_CLUSTER_EDGES.map(([from, to]) => <line key={`${from}-${to}`} x1={nodes[from][0]} y1={nodes[from][1]} x2={nodes[to][0]} y2={nodes[to][1]} />)}
    {nodes.map(([x, y, r], index) => <g key={index}>
      {r >= 6 ? <circle className="auth-node-halo" cx={x} cy={y} r={r * 2.4} filter="url(#auth-glow)" /> : null}
      <circle className="auth-node" cx={x} cy={y} r={r} />
    </g>)}
  </g>;
}

function AuthBackdrop() {
  const [bridgeX, bridgeY, bridgeR] = AUTH_BRIDGE_NODE;
  return <svg className="auth-backdrop" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <filter id="auth-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
    </defs>
    <g className="auth-stars">
      {AUTH_STARS.map((star, index) => <circle key={index} className={star.twinkle ? 'auth-star twinkle' : 'auth-star'} cx={star.x} cy={star.y} r={star.r} opacity={star.opacity} />)}
    </g>
    <g className="auth-network">
      <AuthCluster nodes={AUTH_CLUSTER_LEFT} />
      <AuthCluster nodes={AUTH_CLUSTER_RIGHT} />
      <path className="auth-bridge-glow" d={AUTH_BRIDGE_PATH} filter="url(#auth-glow)" />
      <path className="auth-bridge" d={AUTH_BRIDGE_PATH} />
      <circle className="auth-pulse" r="3" />
      <circle className="auth-node-halo" cx={bridgeX} cy={bridgeY} r={bridgeR * 2.4} filter="url(#auth-glow)" />
      <circle className="auth-node" cx={bridgeX} cy={bridgeY} r={bridgeR} />
    </g>
  </svg>;
}

/* One centered card for every login state: the mark appears once, the
   decorative constellation stays behind it, and notices sit above the form. */
function AuthShell({ children, state, role }: { children: ReactNode; state?: boolean; role?: 'status' | 'alert' }) {
  return <main className={`auth-shell${state ? ' auth-state-shell' : ''}`}>
    <AuthBackdrop />
    <section className={`auth-card${state ? ' auth-state-card' : ''}`} role={role} aria-live={role === 'status' ? 'polite' : undefined}>{children}</section>
  </main>;
}

function AuthHeader({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  return <header className="auth-card-header">
    <div className="auth-brand"><span className="auth-logo"><CustodiaMark /></span><span className="auth-wordmark">{t('Custodia')}</span></div>
    {eyebrow ? <p className="auth-step-label">{eyebrow}</p> : null}
    <h1>{title}</h1>
    {detail ? <p className="auth-card-detail">{detail}</p> : null}
  </header>;
}

function AuthNotices({ message, error }: { message?: string; error?: string }) {
  return <>
    {message ? <div className="auth-notice" role="status"><Info size={15} aria-hidden="true" /><span>{message}</span></div> : null}
    {error ? <div className="auth-error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{error}</span></div> : null}
  </>;
}

function AuthSubmitContent({ busy, idle, pending }: { busy: boolean; idle: string; pending: string }) {
  return <span className="auth-submit-content">{busy ? <span className="auth-submit-spinner" aria-hidden="true" /> : null}<span>{busy ? pending : idle}</span></span>;
}

function PasswordInput({ value, onChange, autoComplete, placeholder, autoFocus }: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return <span className="password-field">
    <input type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
    <button type="button" className="password-visibility" aria-label={visible ? t('Ocultar') : t('Mostrar')} title={visible ? t('Ocultar contraseña') : t('Mostrar contraseña')} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button>
  </span>;
}

export function AuthView({ auth, error }: AuthViewProps) {
  const {
    authStatus, authChecked, loginEmail, setLoginEmail, loginPassword, setLoginPassword, loginBusy,
    passwordChangeBusy, currentPassword, setCurrentPassword, newPassword, setNewPassword,
    newPasswordConfirm, setNewPasswordConfirm, showRegistration, setShowRegistration, registerName,
    setRegisterName, registerPasswordConfirm, setRegisterPasswordConfirm, registerBusy, setupStep,
    setSetupStep, authMessage, authError, authErrorDetails, retryAuth, submitRegistration, submitLogin, submitPasswordChange,
  } = auth;
  if (!authChecked) return <AuthShell state role="status"><AuthHeader title={t('Comprobando tu acceso')} detail="Verificando la sesión antes de cargar Custodia." /></AuthShell>;
  if (authError) return <AuthShell state role="alert">
    <AuthHeader title={t('No se pudo comprobar la sesión')} detail={authError} />
    {authErrorDetails ? <p className="auth-error-reference">{authErrorDetails.status ? `HTTP ${authErrorDetails.status}` : 'Sin respuesta'}{authErrorDetails.path ? ` · ${authErrorDetails.path}` : ''}{authErrorDetails.requestId ? ` · Ref. ${authErrorDetails.requestId}` : ''}</p> : null}
    <button className="button primary auth-submit" type="button" onClick={retryAuth}>{t('Reintentar')}</button>
    {authErrorDetails ? <ErrorDetailsButton details={authErrorDetails} /> : null}
  </AuthShell>;
  if (!authStatus) return null;
  if (!authStatus.authenticated) {
    const setupAvailable = (authStatus.mode === 'local' || authStatus.mode === 'hybrid') && authStatus.setup_available;
    const checks = passwordChecks(loginPassword);
    const passwordScore = checks.filter((check) => check.valid).length;
    const canContinue = loginEmail.trim().length > 0 && registerName.trim().length > 0;
    const canCreate = passwordScore === checks.length && loginPassword === registerPasswordConfirm;
    const localLoginAvailable = authStatus.mode === 'local' || authStatus.mode === 'hybrid';
    const oidcLoginAvailable = authStatus.mode === 'oidc' || authStatus.mode === 'hybrid';
    /* AUTH-AGENT-001: with Okta enabled the main login is Okta only; the local
       form lives on its own path for the automation account. The backend still
       decides who may sign in locally. */
    const selectedLoginMethod = authStatus.mode === 'local' || (authStatus.mode === 'hybrid' && window.location.pathname === LOCAL_LOGIN_PATH) ? 'local' : 'oidc';
    const submitOidcLogin = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = loginEmail.trim();
      window.location.assign('/api/auth/oidc/login' + (email ? '?email=' + encodeURIComponent(email) : ''));
    };
    const header = setupAvailable
      ? !showRegistration
        ? <AuthHeader title={t('Creá la cuenta inicial')} detail="Vas a usarla para ingresar y administrar Custodia." />
        : <AuthHeader eyebrow={`PASO ${setupStep} DE 2`} title={setupStep === 1 ? t('Tus datos') : t('Elegí una contraseña')} />
      : <AuthHeader title={t('Iniciar sesión')} detail="Portal de métricas y relaciones entre herramientas de seguridad" />;

    return <AuthShell>
      {header}
      <AuthNotices message={authMessage} error={error} />
      {setupAvailable && !showRegistration ? <button className="button primary auth-submit" type="button" onClick={() => setShowRegistration(true)}>{t('Crear cuenta')}</button> : null}
      {setupAvailable && showRegistration && <form className="auth-form" noValidate onSubmit={(event) => { event.preventDefault(); if (setupStep === 1) { if (canContinue) setSetupStep(2); return; } void submitRegistration(event); }}>
        {setupStep === 1 ? <><label>{t('Nombre')}<input value={registerName} onChange={(event) => setRegisterName(event.target.value)} autoComplete="name" placeholder={t('Cómo te llamamos')} required /></label><label>{t('Email')}<input type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="tu@email.com" required /></label><button className="button primary auth-submit" type="submit" disabled={!canContinue}>{t('Continuar')}</button></> : <><label>{t('Contraseña')}<PasswordInput value={loginPassword} onChange={setLoginPassword} autoComplete="new-password" placeholder={t('Creá una contraseña')} autoFocus /><div className="password-strength"><div className="password-strength-bar"><span style={{ width: passwordScore * 20 + '%' }} /></div><small>{passwordScore < 3 ? 'Todavía es débil' : passwordScore < 5 ? t('Casi lista') : t('Contraseña segura')}</small></div><div className="password-checks">{checks.map((check) => <span className={check.valid ? 'valid' : ''} key={check.label}>{check.valid ? '✓' : '○'} {check.label}</span>)}</div></label><label>{t('Confirmar contraseña')}<PasswordInput value={registerPasswordConfirm} onChange={setRegisterPasswordConfirm} autoComplete="new-password" placeholder={t('Repetí tu contraseña')} /></label><button className="button primary auth-submit" type="submit" disabled={registerBusy || !canCreate}>{registerBusy ? t('Creando cuenta...') : t('Crear cuenta')}</button><button className="auth-link" type="button" onClick={() => setSetupStep(1)}>{t('Volver')}</button></>}
      </form>}
      {!setupAvailable && <>
        {selectedLoginMethod === 'local' && localLoginAvailable ? <div className="auth-form-stage"><form className="auth-form" noValidate onSubmit={submitLogin}><label>{t('Email')}<input type="email" autoComplete="username" value={loginEmail} placeholder="nombre@empresa.com" autoFocus onChange={(event) => setLoginEmail(event.target.value)} required /></label><label>{t('Contraseña')}<PasswordInput value={loginPassword} onChange={setLoginPassword} autoComplete="current-password" /></label><button className="button primary auth-submit" type="submit" disabled={loginBusy}><AuthSubmitContent busy={loginBusy} idle="Iniciar sesión" pending="Ingresando..." /></button></form>{authStatus.mode === 'hybrid' ? <a className="auth-link" href="/">{t('Entrar con Okta')}</a> : <p className="auth-provider-hint">{t('¿No recordás tu contraseña? Contactá a un administrador.')}</p>}</div> : null}
        {selectedLoginMethod === 'oidc' && oidcLoginAvailable ? <div className="auth-form-stage"><form className="auth-form" noValidate onSubmit={submitOidcLogin}><label>{t('Email corporativo')}<input type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="tu@empresa.com" required /></label><button className="button primary auth-submit" type="submit">{t('Continuar con Okta')}</button></form></div> : null}
      </>}
    </AuthShell>;
  }

  if (authStatus.authenticated && authStatus.user?.must_change_password) {
    const checks = passwordChecks(newPassword);
    return <AuthShell>
      <AuthHeader eyebrow="PRIMER ACCESO" title={t('Elegí tu contraseña')} detail="Reemplazá la contraseña temporal antes de entrar." />
      <AuthNotices error={error} />
      <form className="auth-form" noValidate onSubmit={submitPasswordChange}><label>{t('Contraseña actual')}<PasswordInput value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" /></label><label>{t('Nueva contraseña')}<PasswordInput value={newPassword} onChange={setNewPassword} autoComplete="new-password" autoFocus /><div className="password-checks">{checks.map((check) => <span className={check.valid ? "valid" : ""} key={check.label}>{check.valid ? "✓" : "○"} {check.label}</span>)}</div></label><label>{t('Confirmar contraseña')}<PasswordInput value={newPasswordConfirm} onChange={setNewPasswordConfirm} autoComplete="new-password" /></label><button className="button primary auth-submit" type="submit" disabled={passwordChangeBusy}><AuthSubmitContent busy={passwordChangeBusy} idle="Guardar contraseña" pending="Guardando..." /></button></form>
    </AuthShell>;
  }

  return null;
}
