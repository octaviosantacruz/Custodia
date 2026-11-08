import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { type ErrorDetails } from '../lib/error-details';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { t } from '../i18n/index.ts';

function suggestedAction({ status }: ErrorDetails): string {
  if (!status) return 'Revisá la conexión y volvé a intentar.';
  if (status === 401) return 'Tu sesión venció: volvé a iniciar sesión.';
  if (status === 403) return 'Tu rol no tiene permiso para ver esto; pedí acceso a un administrador.';
  if (status === 404) return 'La fuente no está configurada o el recurso ya no existe.';
  if (status === 429) return 'Demasiadas solicitudes: esperá unos segundos y reintentá.';
  if (status >= 500) return 'Es un error del servidor: reintentá y, si persiste, reportá la referencia.';
  return 'Reintentá; si persiste, reportá la referencia.';
}

/** Opens the technical detail behind a failed request without exposing it in
 * the inline state block: endpoint, status, request id and suggested action. */
export function ErrorDetailsButton({ details, label = 'Ver detalle técnico' }: { details: ErrorDetails; label?: string }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogFocusTrap<HTMLElement>({ onClose: () => setOpen(false) });

  return <>
    <button type="button" className="button subtle" onClick={() => setOpen(true)}>{label}</button>
    {open ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} className="confirm-dialog error-details-dialog" role="dialog" aria-modal="true" aria-labelledby="error-details-title" tabIndex={-1}>
        <div className="confirm-dialog-header">
          <div className="confirm-dialog-icon"><AlertCircle size={18} /></div>
          <button className="icon-button" type="button" aria-label={t('Cerrar')} title={t('Cerrar')} onClick={() => setOpen(false)}><X size={16} /></button>
        </div>
        <h2 id="error-details-title">{t('Detalle del error')}</h2>
        <dl className="error-details-list">
          <div><dt>{t('Tipo')}</dt><dd>{details.status ? `HTTP ${details.status}` : 'Error de red o del cliente'}</dd></div>
          <div><dt>{t('Endpoint')}</dt><dd>{details.path || 'No disponible'}</dd></div>
          <div><dt>{t('Referencia')}</dt><dd>{details.requestId || 'No disponible'}</dd></div>
          <div><dt>{t('Mensaje')}</dt><dd>{details.message}</dd></div>
          <div><dt>{t('Acción sugerida')}</dt><dd>{suggestedAction(details)}</dd></div>
        </dl>
        <div className="confirm-dialog-actions">
          <button className="button primary" type="button" onClick={() => setOpen(false)}>{t('Cerrar')}</button>
        </div>
      </section>
    </div> : null}
  </>;
}
