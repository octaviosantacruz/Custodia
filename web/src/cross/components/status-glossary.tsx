import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import './semantic.css';
import { t } from '../i18n/index.ts';

type GlossaryGroup = { title: string; entries: { label: string; description: string }[] };

export type GlossaryScope = 'all' | 'status' | 'next_action' | 'account_type' | 'business_unit' | 'responsible' | 'inventory_scope' | 'data_quality' | 'member_access' | 'safe_health' | 'sia_policy';

const GROUPS: GlossaryGroup[] = [
  {
    title: t('Estado operativo (Safe)'),
    entries: [
      { label: t('Pendiente'), description: t('Todavía no se revisó ni se le asignó unidad/responsable.') },
      { label: t('En curso'), description: t('La revisión o remediación está en marcha.') },
      { label: t('Baja retenida'), description: t('Se pidió la baja pero CyberArk no permite borrar la Safe mientras dure su retención. Puede marcarse manualmente o cuando una sync completa retira sus cuentas y la baja estaba pendiente. Custodia no calcula cuándo se podrá borrar.') },
      { label: t('Resuelto'), description: t('La revisión operativa quedó completa.') },
    ],
  },
  {
    title: t('Acción siguiente'),
    entries: [
      { label: t('Migrar a SIA'), description: t('Candidato a moverse a Secure Infrastructure Access.') },
      { label: t('Consultar'), description: t('Requiere confirmar datos con el equipo dueño del Safe.') },
      { label: t('Revisar'), description: t('Requiere una revisión operativa antes de decidir su destino.') },
      { label: t('Dar de baja'), description: t('Marcado para retiro por el equipo operativo; no se elimina automáticamente.') },
      { label: t('Rotar credencial'), description: t('La credencial asociada necesita rotación.') },
      { label: t('Sin definir'), description: t('Todavía no se eligió una acción siguiente.') },
    ],
  },
  {
    title: t('Unidad de negocio'),
    entries: [
      { label: t('Sin asignar'), description: t('Todavía no se asignó una unidad responsable de este Safe.') },
      { label: t('Unidad asignada'), description: t('El Safe quedó vinculado a una unidad del catálogo operativo.') },
    ],
  },
  {
    title: t('Responsable'),
    entries: [
      { label: t('Sin asignar'), description: t('Todavía no se definió una persona referente para este Safe.') },
      { label: t('Responsable asignado'), description: t('La persona indicada es el referente operativo para revisar este Safe.') },
    ],
  },
  {
    title: t('Alcance del inventario (KR1)'),
    entries: [
      { label: t('Pendiente de definir'), description: t('No se clasificó si el Safe es de negocio o interno de CyberArk.') },
      { label: t('Safe de negocio'), description: t('Cuenta para las métricas de cobertura operativa.') },
      { label: t('Interno CyberArk'), description: t('Excluido de las métricas de negocio por decisión explícita.') },
    ],
  },
  {
    title: t('Calidad del dato'),
    entries: [
      { label: t('Pendiente'), description: t('Todavía no se evaluó la calidad de la información del Safe.') },
      { label: t('Depurado'), description: t('Los datos fueron revisados y son confiables.') },
      { label: t('Obsoleto'), description: t('La información quedó desactualizada.') },
      { label: t('Duplicado'), description: t('Este registro se solapa con otro Safe existente.') },
    ],
  },
  {
    title: t('Safe Health'),
    entries: [
      { label: t('Safe Health'), description: t('Señales técnicas del inventario actual que ayudan a revisar CPM, cuentas, retención y concentración de Manage Safe.') },
      { label: t('Referencia técnica'), description: t('Otros atributos informados por CyberArk se conservan en el detalle de cada Safe, pero no se consideran un problema sin una política que los exija.') },
    ],
  },
  {
    title: t('Tipo de cuenta'),
    entries: [
      { label: t('Nominal'), description: t('Cuenta asociada a una persona identificable.') },
      { label: t('No Nominal'), description: t('Cuenta compartida o sin dueño individual claro.') },
      { label: t('CyberArk Managed / Interno'), description: t('Cuenta administrada por CyberArk para uso interno de la plataforma.') },
    ],
  },
  {
    title: t('Miembros del Safe'),
    entries: [
      { label: t('Acceso'), description: t('El miembro puede operar sobre las cuentas del Safe (no solo leer).') },
      { label: t('Solo lectura'), description: t('El miembro únicamente puede consultar, sin permisos de uso.') },
    ],
  },
  {
    title: t('Política SIA'),
    entries: [
      { label: t('Habilitada'), description: t('La política está activa y aplicándose.') },
      { label: t('Deshabilitada'), description: t('La política existe pero no se está aplicando.') },
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
  const title = scope === 'all' ? t('Glosario de referencia') : t('Glosario de ') + SCOPE_TITLES[scope];
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
            <button type="button" className="status-glossary-back" onClick={() => setOpen(false)}><ArrowLeft size={16} /><span>{t('Volver')}</span></button>
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
