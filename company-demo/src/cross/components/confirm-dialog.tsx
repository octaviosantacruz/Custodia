import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';

type ConfirmDialogProps = {
  icon: ReactNode;
  titleId: string;
  title: string;
  descriptionId: string;
  description: ReactNode;
  children?: ReactNode;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  closeDisabled?: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  confirmBusyLabel: string;
  confirmBusy: boolean;
  confirmDisabled?: boolean;
  confirmTone?: 'danger' | 'primary';
  onConfirm: () => void;
  backdropClassName?: string;
};

/**
 * Shared destructive/confirmation dialog primitive. Consolidates the
 * backdrop-click-to-close handler and the alertdialog markup that used to be
 * copy-pasted at each call site (user-admin.tsx delete/reissue,
 * dashboard delete metric), and wires up
 * useDialogFocusTrap so Tab/Shift+Tab stay inside the dialog and focus
 * returns to the triggering control once it closes.
 */
export function ConfirmDialog({
  icon,
  titleId,
  title,
  descriptionId,
  description,
  children,
  fallbackFocusRef,
  onClose,
  closeDisabled = false,
  cancelLabel = 'Cancelar',
  confirmLabel,
  confirmBusyLabel,
  confirmBusy,
  confirmDisabled = false,
  confirmTone = 'danger',
  onConfirm,
  backdropClassName = '',
}: ConfirmDialogProps) {
  const dialogRef = useDialogFocusTrap<HTMLElement>({ onClose: closeDisabled ? undefined : onClose, fallbackFocusRef });

  return <div className={`confirm-backdrop ${backdropClassName}`.trim()} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}>
    <section ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <div className="confirm-dialog-header">
        <div className="confirm-dialog-icon">{icon}</div>
        <button className="icon-button" type="button" aria-label="Cerrar" title="Cerrar" onClick={onClose} disabled={closeDisabled}><X size={16} /></button>
      </div>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {children}
      <div className="confirm-dialog-actions">
        <button className="button subtle" type="button" onClick={onClose} disabled={closeDisabled}>{cancelLabel}</button>
        <button className={`button ${confirmTone}`} type="button" onClick={onConfirm} disabled={confirmDisabled || confirmBusy}>{confirmBusy ? confirmBusyLabel : confirmLabel}</button>
      </div>
    </section>
  </div>;
}
