import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export type OverflowAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  tone?: 'default' | 'primary' | 'danger';
};

type OverflowActionsProps = {
  actions: OverflowAction[];
  className?: string;
  ariaLabel: string;
  minVisible?: number;
};

export function OverflowActions({ actions, className = '', ariaLabel, minVisible = 1 }: OverflowActionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [visibleCount, setVisibleCount] = useState(actions.length);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const widths = actionRefs.current.map((element) => element?.offsetWidth || 0);
    const total = widths.reduce((sum, width) => sum + width, 0);
    const gap = Number.parseFloat(getComputedStyle(container).gap || '0') || 0;
    if (total + gap * Math.max(0, actions.length - 1) <= container.clientWidth) {
      setVisibleCount(actions.length);
      return;
    }
    const triggerWidth = 38;
    let consumed = triggerWidth + gap;
    let count = 0;
    for (const width of widths) {
      if (count >= minVisible && consumed + width + gap > container.clientWidth) break;
      consumed += width + gap;
      count += 1;
    }
    setVisibleCount(Math.max(0, Math.min(actions.length - 1, count)));
  }, [actions.length, minVisible]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      right: Math.max(8, window.innerWidth - rect.right),
      top: rect.bottom + 6,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    firstItem?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, positionMenu]);

  const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  };

  const inlineActions = actions.slice(0, visibleCount);
  const overflowActions = actions.slice(visibleCount);
  const hasOverflow = overflowActions.length > 0;

  return <div className={`overflow-actions ${className}`.trim()} ref={containerRef} aria-label={ariaLabel}>
    {actions.map((action, index) => <button
      key={action.id}
      ref={(element) => { actionRefs.current[index] = element; }}
      className={`button ${action.tone === 'primary' ? 'primary' : action.tone === 'danger' ? 'danger' : 'subtle'} overflow-actions-measure`}
      type="button"
      tabIndex={-1}
      aria-hidden
    >
      {action.icon}{action.label}
    </button>)}
    {inlineActions.map((action) => <button
      key={action.id}
      className={`button ${action.tone === 'primary' ? 'primary' : action.tone === 'danger' ? 'danger' : 'subtle'}`}
      type="button"
      disabled={action.disabled}
      title={action.title}
      onClick={action.onSelect}
    >
      {action.icon}{action.label}
    </button>)}
    {hasOverflow && <button
      ref={triggerRef}
      className="icon-button overflow-actions-trigger"
      type="button"
      aria-label={`Más acciones: ${ariaLabel}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Más acciones"
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
        }
      }}
    ><MoreHorizontal size={17} aria-hidden /></button>}
    {open && hasOverflow && createPortal(
      <div ref={menuRef} className="overflow-actions-menu" role="menu" aria-label={ariaLabel} style={menuStyle} onKeyDown={moveMenuFocus}>
        {overflowActions.map((action) => <button
          key={action.id}
          className={action.tone === 'danger' ? 'danger' : ''}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          title={action.title}
          onClick={() => { setOpen(false); action.onSelect(); }}
        >{action.icon}{action.label}</button>)}
      </div>,
      document.body,
    )}
  </div>;
}
