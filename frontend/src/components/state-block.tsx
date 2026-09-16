import type { ReactNode } from 'react';
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
}: {
  variant?: StateVariant;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  const Icon = ICONS[variant];
  return (
    <div className={`state-block state-block-${variant}`} role={variant === 'loading' ? 'status' : undefined}>
      <span className="state-block-icon">
        <Icon size={20} className={variant === 'loading' ? 'spin' : undefined} aria-hidden />
      </span>
      <p className="state-block-title">{title}</p>
      {hint ? <p className="state-block-hint">{hint}</p> : null}
      {action ? <div className="state-block-action">{action}</div> : null}
    </div>
  );
}
