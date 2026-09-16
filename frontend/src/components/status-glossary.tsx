import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';

type GlossaryGroup = { title: string; entries: { label: string; description: string }[] };

export type GlossaryScope = 'all' | 'status' | 'next_action' | 'account_type' | 'business_unit' | 'responsible' | 'inventory_scope' | 'data_quality' | 'member_access' | 'safe_health' | 'sia_policy';

const GROUPS: GlossaryGroup[] = [
  {
    title: 'Estado operativo (Safe)',
    entries: [
      { label: 'Pendiente', description: 'Todavía no se revisó ni se le asignó unidad/responsable.' },
      { label: 'En curso', description: 'La revisión o remediación está en marcha.' },
      { label: 'Resuelto', description: 'La revisión operativa quedó completa.' },
    ],
  },
  {
    title: 'Acción siguiente',
    entries: [
      { label: 'Migrar a SIA', description: 'Candidato a moverse a Secure Infrastructure Access.' },
      { label: 'Consultar', description: 'Requiere confirmar datos con el equipo dueño del Safe.' },
      { label: 'Revisar', description: 'Requiere una revisión operativa antes de decidir su destino.' },
      { label: 'Dar de baja', description: 'Marcado para retiro por el equipo operativo; no se elimina automáticamente.' },
      { label: 'Rotar credencial', description: 'La credencial asociada necesita rotación.' },
      { label: 'Sin definir', description: 'Todavía no se eligió una acción siguiente.' },
    ],
  },
  {
    title: 'Unidad de negocio',
    entries: [
      { label: 'Sin asignar', description: 'Todavía no se asignó una unidad responsable de este Safe.' },
      { label: 'Unidad asignada', description: 'El Safe quedó vinculado a una unidad del catálogo operativo.' },
    ],
  },
  {
    title: 'Responsable',
    entries: [
      { label: 'Sin asignar', description: 'Todavía no se definió una persona referente para este Safe.' },
      { label: 'Responsable asignado', description: 'La persona indicada es el referente operativo para revisar este Safe.' },
    ],
  },
  {
    title: 'Alcance del inventario (KR1)',
    entries: [
      { label: 'Pendiente de definir', description: 'No se clasificó si el Safe es de negocio o interno de CyberArk.' },
      { label: 'Safe de negocio', description: 'Cuenta para las métricas de cobertura operativa.' },
      { label: 'Interno CyberArk', description: 'Excluido de las métricas de negocio por decisión explícita.' },
    ],
  },
  {
    title: 'Calidad del dato',
    entries: [
      { label: 'Pendiente', description: 'Todavía no se evaluó la calidad de la información del Safe.' },
      { label: 'Depurado', description: 'Los datos fueron revisados y son confiables.' },
      { label: 'Obsoleto', description: 'La información quedó desactualizada.' },
      { label: 'Duplicado', description: 'Este registro se solapa con otro Safe existente.' },
    ],
  },
  {
    title: 'Safe Health',
    entries: [
      { label: 'Safe Health', description: 'Señales técnicas del inventario actual que ayudan a revisar CPM, cuentas, retención y concentración de Manage Safe.' },
      { label: 'Referencia técnica', description: 'Otros atributos informados por CyberArk se conservan en el detalle de cada Safe, pero no se consideran un problema sin una política que los exija.' },
    ],
  },
  {
    title: 'Tipo de cuenta',
    entries: [
      { label: 'Nominal', description: 'Cuenta asociada a una persona identificable.' },
      { label: 'No Nominal', description: 'Cuenta compartida o sin dueño individual claro.' },
      { label: 'CyberArk Managed / Interno', description: 'Cuenta administrada por CyberArk para uso interno de la plataforma.' },
    ],
  },
  {
    title: 'Miembros del Safe',
    entries: [
      { label: 'Acceso', description: 'El miembro puede operar sobre las cuentas del Safe (no solo leer).' },
      { label: 'Solo lectura', description: 'El miembro únicamente puede consultar, sin permisos de uso.' },
    ],
  },
  {
    title: 'Política SIA',
    entries: [
      { label: 'Habilitada', description: 'La política está activa y aplicándose.' },
      { label: 'Deshabilitada', description: 'La política existe pero no se está aplicando.' },
    ],
  },
];

const SCOPE_TITLES: Record<Exclude<GlossaryScope, 'all'>, string> = {
  status: 'Estado operativo (Safe)',
  next_action: 'Acción siguiente',
  account_type: 'Tipo de cuenta',
  business_unit: 'Unidad de negocio',
  responsible: 'Responsable',
  inventory_scope: 'Alcance del inventario (KR1)',
  data_quality: 'Calidad del dato',
  member_access: 'Miembros del Safe',
  safe_health: 'Safe Health',
  sia_policy: 'Política SIA',
};

function groupsForScope(scope: GlossaryScope): GlossaryGroup[] {
  if (scope === 'all') return GROUPS;
  return GROUPS.filter((group) => group.title === SCOPE_TITLES[scope]);
}

type StatusGlossaryProps = { scope?: GlossaryScope; compact?: boolean };

export function StatusGlossary({ scope = 'all', compact = false }: StatusGlossaryProps) {
  const [open, setOpen] = useState(false);
  const title = scope === 'all' ? 'Glosario de referencia' : 'Glosario de ' + SCOPE_TITLES[scope];
  const groups = groupsForScope(scope);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ active: open, onClose: () => setOpen(false) });

  return <>
    <button
      type="button"
      className={'status-glossary-trigger' + (compact ? ' compact' : '')}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={title}
      aria-label={title}
      onClick={() => setOpen(true)}
    >
      <HelpCircle size={16} />
    </button>
    {open && createPortal(
      <div className="status-glossary-overlay" role="presentation" onClick={() => setOpen(false)}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className="status-glossary-page" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <div className="status-glossary-page-header">
            <button type="button" className="status-glossary-back" onClick={() => setOpen(false)}><ArrowLeft size={16} /><span>Volver</span></button>
            <div>
              <p className="eyebrow">REFERENCIA</p>
              <h2>{title}</h2>
            </div>
          </div>
          <div className="status-glossary-page-body">
            {groups.map((group) => <div className="status-glossary-group" key={group.title}>
              <h4>{group.title}</h4>
              <dl>{group.entries.map((entry) => <div className="status-glossary-entry" key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>{entry.description}</dd>
              </div>)}</dl>
            </div>)}
          </div>
        </div>
      </div>,
      document.body,
    )}
  </>;
}
