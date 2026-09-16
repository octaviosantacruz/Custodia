import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type CompactSelectOption = { value: string; label: string };

type CompactSelectProps = { value: string; options: CompactSelectOption[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean; className?: string; onAdd?: () => void; addLabel?: string };

export function CompactSelect({ value, options, onChange, ariaLabel, disabled = false, className = "", onAdd, addLabel = "Agregar" }: CompactSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) || options[0];
  const positionMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 150);
    setMenuStyle({ position: "fixed", left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), minWidth: width, top: rect.bottom + 5 });
  };
  useLayoutEffect(() => { if (open) positionMenu(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => { const target = event.target as Node; if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false); };
    const reposition = () => positionMenu();
    document.addEventListener("mousedown", closeOnOutside); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("mousedown", closeOnOutside); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);
  const choose = (nextValue: string) => { onChange(nextValue); setOpen(false); triggerRef.current?.focus(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") { setOpen(false); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen((current) => !current); return; }
    if (!open || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));
    const nextIndex = event.key === "ArrowDown" ? Math.min(options.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
    choose(options[nextIndex].value);
  };
  return <div className={`custom-select compact-select ${className}`}>
    <button ref={triggerRef} className="custom-select-trigger" type="button" aria-label={ariaLabel} title={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)} onKeyDown={handleKeyDown}><span>{selected?.label || "Sin definir"}</span><ChevronDown size={14} /></button>
    {open && createPortal(<div ref={menuRef} className="custom-select-menu compact-select-menu" role="listbox" style={menuStyle}>{options.map((option) => <button key={option.value} className={`custom-select-option ${option.value === value ? "selected" : ""}`} type="button" role="option" aria-selected={option.value === value} onClick={() => choose(option.value)}><span>{option.label}</span>{option.value === value && <Check size={14} />}</button>)}{onAdd && <><div className="custom-select-divider" /><button className="custom-select-add" type="button" onClick={() => { setOpen(false); onAdd(); }}><span>+</span><span>{addLabel}</span></button></>}</div>, document.body)}
  </div>;
}
