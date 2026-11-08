import type { ReactNode } from 'react';
import './state-block.css';
import { Inbox, LoaderCircle, SearchX, TriangleAlert } from 'lucide-react';

type StateVariant = 'empty' | 'no-results' | 'loading' | 'error';

const ICONS: Record<StateVariant, typeof Inbox> = {
  empty: Inbox,
  'no-results': SearchX,
  loading: LoaderCircle,
  error: TriangleAlert,
};

export function StateBlock({
  variant = 'empty',
  title,
  hint,
  action,
  compact = false,
}: {
  variant?: StateVariant;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const Icon = ICONS[variant];
  return (
    <div className={`state-block state-block-${variant}${compact ? ' state-block-compact' : ''}`} role={variant === 'loading' ? 'status' : undefined}>
      {!compact ? <span className="state-block-icon">
        <Icon size={20} className={variant === 'loading' ? 'spin' : undefined} aria-hidden />
      </span> : null}
      <p className="state-block-title">{title}</p>
      {hint ? <p className="state-block-hint">{hint}</p> : null}
      {action ? <div className="state-block-action">{action}</div> : null}
    </div>
  );
}
