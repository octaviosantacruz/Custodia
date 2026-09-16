import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';

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
        <div><p className="eyebrow">CATÁLOGO</p><h2 id="catalog-modal-title">{isUnit ? 'Nueva unidad' : 'Nuevo responsable'}</h2><p>{isUnit ? 'Agregá una unidad para asignarla a los safes.' : 'Agregá una persona responsable del inventario.'}</p></div>
        <button className="icon-button" type="button" aria-label="Cerrar" title="Cerrar catálogo" onClick={onClose}><X size={17} /></button>
      </div>
      <div className="catalog-modal-fields">
        {isUnit ? <>
          <label>Código<input value={draft.code} onChange={(event) => onDraftChange({ code: event.target.value })} placeholder="Ej. UENO" required /></label>
          <label>Nombre<input value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} placeholder="Nombre de la unidad" required /></label>
        </> : <>
          <label>Nombre<input value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} placeholder="Nombre y apellido" required /></label>
          <label>Email<input type="email" value={draft.email} onChange={(event) => onDraftChange({ email: event.target.value })} placeholder="correo@itti.digital" required /></label>
        </>}
      </div>
      <div className="catalog-modal-actions"><button className="button subtle" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</button></div>
    </form>
  </div>;
}
