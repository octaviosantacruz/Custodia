import { Check, Eye, EyeOff, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { MIN_PASSWORD_LENGTH, passwordFeedback, passwordRequirements } from '../lib/password-policy';

type Props = {
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
};

export function RegistrationPasswordFields({ password, confirmation, onPasswordChange, onConfirmationChange }: Props) {
  const [visible, setVisible] = useState(false);
  const feedback = passwordFeedback(password, confirmation);
  const checks = passwordRequirements(password);
  return <>
    <div className="registration-password-field">
      <label htmlFor="registration-password">Contraseña</label>
      <div className="registration-password-input">
        <input id="registration-password" type={visible ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Creá una contraseña" aria-describedby="registration-policy" autoFocus required />
        <button type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </div>
      <div id="registration-policy" className={`registration-policy${feedback.valid ? ' is-complete' : ''}`}>
        <div className="registration-policy-heading">
          <span className="registration-policy-light" aria-hidden="true"><Lightbulb size={20} /></span>
          <span role="status">{feedback.valid ? 'Requisitos cumplidos' : password ? 'Completá los requisitos' : 'Creá tu contraseña'}</span>
          <span className="registration-policy-count" aria-hidden="true">{Array.from(password).length} / {MIN_PASSWORD_LENGTH} mín.</span>
        </div>
        <progress className="registration-policy-progress" value={feedback.progress} max={100} aria-label="Requisitos de contraseña cumplidos" />
        <ul className="registration-policy-checks">{checks.map((check) => <li className={check.valid ? 'valid' : ''} key={check.label}><span className="registration-policy-dot" aria-hidden="true">{check.valid ? <Check size={12} /> : null}</span>{check.label}{check.valid ? ' · Cumplido' : ''}</li>)}</ul>
        <p>Podés usar una frase con un número y un símbolo. Al guardar, también se verifica que no sea demasiado común.</p>
      </div>
    </div>
    <div className="registration-password-field">
      <label htmlFor="registration-password-confirm">Confirmar contraseña</label>
      <input id="registration-password-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => onConfirmationChange(event.target.value)} placeholder="Repetí tu contraseña" aria-describedby="registration-password-match" required />
      <p id="registration-password-match" className={`registration-password-match${feedback.matches ? ' is-complete' : ''}`} role="status"><span aria-hidden="true">{feedback.matches ? <Check size={15} /> : <span className="registration-policy-dot" />}</span>{feedback.matches ? 'Las contraseñas coinciden' : confirmation ? 'Todavía no coinciden' : 'Repetila para confirmar tu contraseña'}</p>
    </div>
  </>;
}
