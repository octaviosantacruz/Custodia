import { useState, type FormEvent } from 'react';
import { Check, LockKeyhole, Save, UserCircle, X } from 'lucide-react';
import { api } from '../lib/api';
import { primaryRoleLabel } from '../lib/auth-role-label';
import { passwordRequirements } from '../lib/password-policy';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import type { AuthStatus } from '../types/auth';

type AccountProfileModalProps = {
  authStatus: AuthStatus;
  onClose: () => void;
  onNotice: (message: string) => void;
  onProfileUpdated: (name: string) => void;
};

export function AccountProfileModal({ authStatus, onClose, onNotice, onProfileUpdated }: AccountProfileModalProps) {
  const user = authStatus.user;
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [nameBusy, setNameBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const checks = passwordRequirements(newPassword);
  const isLocal = authStatus.mode === 'local';
  const busy = nameBusy || passwordBusy;
  const dialogRef = useDialogFocusTrap<HTMLElement>({ onClose: busy ? undefined : onClose });

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      setFormError('Ingresá un nombre.');
      return;
    }
    setNameBusy(true);
    setFormError('');
    try {
      await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ display_name: normalizedName }) });
      onProfileUpdated(normalizedName);
      onNotice('Nombre actualizado.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo actualizar el nombre.');
    } finally {
      setNameBusy(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!checks.every((check) => check.valid)) {
      setFormError('La nueva contraseña no cumple todas las condiciones.');
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setFormError('Las contraseñas nuevas no coinciden.');
      return;
    }
    setPasswordBusy(true);
    setFormError('');
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordConfirmation('');
      onNotice('Contraseña actualizada.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo actualizar la contraseña.');
    } finally {
      setPasswordBusy(false);
    }
  };

  return <div className="profile-account-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="profile-account-modal" role="dialog" aria-modal="true" aria-labelledby="profile-account-title" tabIndex={-1}>
      <header className="profile-account-header">
        <div className="profile-account-heading"><div className="profile-account-icon"><UserCircle size={20} /></div><div><p className="eyebrow">MI CUENTA</p><h2 id="profile-account-title">Datos personales</h2><p>Solo podés modificar los datos de tu propia cuenta.</p></div></div>
        <button className="icon-button" type="button" aria-label="Cerrar Mi cuenta" title="Cerrar" onClick={onClose} disabled={nameBusy || passwordBusy}><X size={16} /></button>
      </header>
      <div className="profile-account-summary"><div><span>Email</span><strong>{user?.email || 'Sin email disponible'}</strong></div><div><span>Rol</span><strong>{primaryRoleLabel(authStatus)}</strong></div></div>
      {!isLocal ? <div className="profile-account-managed"><LockKeyhole size={17} /><div><strong>Cuenta administrada por tu identidad corporativa</strong><span>El nombre, email y contraseña se modifican en el proveedor de identidad.</span></div></div> : <div className="profile-account-sections">
        <form className="profile-account-section" onSubmit={saveName}>
          <div className="profile-account-section-heading"><div><h3>Nombre visible</h3><p>Es el nombre que verán otros usuarios en DS Hub.</p></div></div>
          <label className="profile-account-field">Nombre<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={160} autoComplete="name" /></label>
          <div className="profile-account-actions"><button className="button primary" type="submit" disabled={nameBusy || !displayName.trim() || displayName.trim() === (user?.name || '').trim()}><Save size={14} /> {nameBusy ? 'Guardando...' : 'Guardar nombre'}</button></div>
        </form>
        <form className="profile-account-section" onSubmit={savePassword}>
          <div className="profile-account-section-heading"><div><h3>Contraseña</h3><p>Usá tu contraseña actual para definir una nueva.</p></div></div>
          <label className="profile-account-field">Contraseña actual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
          <label className="profile-account-field">Nueva contraseña<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required /><span className="profile-account-password-checks">{checks.map((check) => <span className={check.valid ? 'valid' : ''} key={check.label}>{check.valid ? <Check size={12} /> : '○'} {check.label}</span>)}</span></label>
          <label className="profile-account-field">Confirmar contraseña<input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" required /></label>
          <div className="profile-account-actions"><button className="button primary" type="submit" disabled={passwordBusy || !currentPassword || !newPassword || !passwordConfirmation}><LockKeyhole size={14} /> {passwordBusy ? 'Guardando...' : 'Cambiar contraseña'}</button></div>
        </form>
      </div>}
      {formError && <p className="profile-account-error" role="alert">{formError}</p>}
    </section>
  </div>;
}
