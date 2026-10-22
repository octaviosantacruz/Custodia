import { useId, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import './help-hint.css';

type Props = { label: string; children: ReactNode };

/** Explanatory prose lives behind a "?" button instead of on the page: the
 *  screen shows data, and the definition is one click away. Escape and an
 *  outside click close it; focus returns to the button. */
export function HelpHint({ label, children }: Props) {
  const { open, setOpen, ref } = usePopover<HTMLSpanElement>();
  const id = useId();
  return <span className="help-hint" ref={ref}>
    <button type="button" className={`help-hint-button${open ? ' is-open' : ''}`} aria-label={`Ayuda: ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} title={`Ayuda: ${label}`} onClick={() => setOpen((current) => !current)}>
      <CircleHelp size={14} aria-hidden="true" />
    </button>
    {open ? <div className="help-hint-popover" id={id} role="note">{children}</div> : null}
  </span>;
}
