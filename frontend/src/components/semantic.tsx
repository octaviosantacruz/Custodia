import type { ReactNode } from 'react';
import { Bot } from 'lucide-react';

/* Shared connective pieces for the Roles / SIA / Activity tables.
   StatusBadge tone -> the existing --status-* pill tokens; only
   'identity' is a new triplet (see styles.css). The rest reuse the
   workflow pill palette so light/dark stay in sync with what exists. */

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'identity';

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`status-badge tone-${tone}`}>
      <span className="status-badge-dot" aria-hidden />
      {children}
    </span>
  );
}

export function TagChip({ label, title }: { label: string; title?: string }) {
  return <span className="tag-chip" title={title || label}>{label}</span>;
}

/* Renders up to `max` tag chips from a list, then a "+N" overflow chip.
   The overflow chip's title lists the hidden values so nothing is lost. */
export function TagChipList({ values, max = 3 }: { values: string[]; max?: number }) {
  if (!values.length) return <span className="muted">Sin dato</span>;
  const shown = values.slice(0, max);
  const rest = values.slice(max);
  return (
    <span className="tag-chip-list">
      {shown.map((value) => (
        <TagChip key={value} label={value} />
      ))}
      {rest.length ? <TagChip label={`+${rest.length}`} title={rest.join(', ')} /> : null}
    </span>
  );
}

/* Action -> risk tone for the audit log. The colour carries the category;
   'sync' (neutral) is the fallback for system events with no listed verb. */
const ACTION_TONE: Record<string, string> = {
  create: 'create',
  update: 'update',
  role_change: 'auth',
  delete: 'delete',
  export: 'export',
};

export function actionTone(action: string): string {
  return ACTION_TONE[action] || 'sync';
}

export function ActionTag({ action, label }: { action: string; label: string }) {
  return (
    <span className={`action-tag t-${actionTone(action)}`}>
      <span className="action-tag-dot" aria-hidden />
      {label}
    </span>
  );
}

type IdentityKind = 'user' | 'group' | 'role' | 'system';

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toneIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 5;
}

/* onSelect turns the chip into the cross-view pivot (Activity actor,
   SIA grantee, Roles member all point at the same identity). Left
   optional so callers can adopt it one table at a time. */
export function IdentityChip({
  name,
  kind = 'user',
  subtitle,
  onSelect,
}: {
  name: string;
  kind?: IdentityKind;
  subtitle?: string;
  onSelect?: () => void;
}) {
  const shape = kind === 'group' || kind === 'role' ? 'square' : 'round';
  const avatar =
    kind === 'system' ? (
      <span className="identity-avatar is-system" aria-hidden>
        <Bot size={12} />
      </span>
    ) : (
      <span className={`identity-avatar av-${toneIndex(name)} shape-${shape}`} aria-hidden>
        {initials(name)}
      </span>
    );
  const body = (
    <>
      {avatar}
      <span className="identity-text">
        <b>{name}</b>
        {subtitle ? <span>{subtitle}</span> : null}
      </span>
    </>
  );
  if (onSelect) {
    return (
      <button
        type="button"
        className="identity-chip is-link"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {body}
      </button>
    );
  }
  return <span className="identity-chip">{body}</span>;
}
