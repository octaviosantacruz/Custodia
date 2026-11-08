import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import { t } from '../../../cross/i18n/index.ts';

type CatalogKind = 'unit' | 'responsible';
type CatalogDraft = { code: string; name: string; email: string };

type CatalogModalProps = {
  kind: CatalogKind;
  draft: CatalogDraft;
  busy: boolean;
  onDraftChange: (updates: Partial<CatalogDraft>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

export function CatalogModal({ kind, draft, busy, onDraftChange, onSubmit, onClose }: CatalogModalProps) {
  const isUnit = kind === 'unit';
  const dialogRef = useDialogFocusTrap<HTMLFormElement>({ onClose: busy ? undefined : onClose });
  return <div className="catalog-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={dialogRef} className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-modal-title" tabIndex={-1} onSubmit={onSubmit}>
      <div className="catalog-modal-header">
        <div><p className="eyebrow">{t('CATÁLOGO')}</p><h2 id="catalog-modal-title">{isUnit ? t('Nueva unidad') : t('Nuevo responsable')}</h2><p>{isUnit ? t('Agregá una unidad para asignarla a los safes.') : t('Agregá una persona responsable del inventario.')}</p></div>
        <button className="icon-button" type="button" aria-label={t('Cerrar')} title={t('Cerrar catálogo')} onClick={onClose}><X size={17} /></button>
      </div>
      <div className="catalog-modal-fields">
        {isUnit ? <>
          <label>{t('Código')}<input value={draft.code} onChange={(event) => onDraftChange({ code: event.target.value })} placeholder={t('Ej. GLOBEX')} required /></label>
          <label>{t('Nombre')}<input value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} placeholder={t('Nombre de la unidad')} required /></label>
        </> : <>
          <label>{t('Nombre')}<input value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} placeholder={t('Nombre y apellido')} required /></label>
          <label>{t('Email')}<input type="email" value={draft.email} onChange={(event) => onDraftChange({ email: event.target.value })} placeholder="correo@empresa.example" required /></label>
        </>}
      </div>
      <div className="catalog-modal-actions"><button className="button subtle" type="button" onClick={onClose}>{t('Cancelar')}</button><button className="button primary" type="submit" disabled={busy}>{busy ? t('Guardando...') : t('Guardar')}</button></div>
    </form>
  </div>;
}
