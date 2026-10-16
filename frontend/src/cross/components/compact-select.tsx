import { useState } from "react";
import { Button, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import { Check, ChevronDown } from "lucide-react";
import './compact-select.css';

export type CompactSelectOption = { value: string; label: string };

type CompactSelectProps = { value: string; options: CompactSelectOption[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean; className?: string; onAdd?: () => void; addLabel?: string };

/* FE-A11Y-001 pilot: React Aria Components owns the keyboard, typeahead,
   focus and overlay behaviour; DS Hub keeps its own classes and CSS, and
   `--trigger-width` replaces the hand-computed minimum width. The popover
   stays in RAC's default (modal) mode on purpose: the non-modal variant
   focuses the selected option on open, the browser scrolls it into view and
   RAC's close-on-scroll dismisses the menu (reproduced with selects near the
   fold). Modal mode keeps the menu open and traps Tab inside it until
   Escape/selection, which is RAC's documented Select behaviour. */
export function CompactSelect({ value, options, onChange, ariaLabel, disabled = false, className = "", onAdd, addLabel = "Agregar" }: CompactSelectProps) {
  const selected = options.find((option) => option.value === value) || options[0];
  const [open, setOpen] = useState(false);
  return <Select
    className={`custom-select compact-select ${className}`}
    aria-label={ariaLabel}
    isDisabled={disabled}
    selectedKey={selected ? selected.value : null}
    onSelectionChange={(key) => { if (key != null) onChange(String(key)); }}
    isOpen={open}
    onOpenChange={setOpen}
  >
    <Button className="custom-select-trigger">
      <SelectValue>{({ selectedText }) => selectedText || "Sin definir"}</SelectValue>
      <ChevronDown size={14} />
    </Button>
    <Popover className="custom-select-menu compact-select-menu" offset={5} style={{ minWidth: "max(150px, var(--trigger-width))" }}>
      <ListBox aria-label={ariaLabel}>
        {options.map((option) => <ListBoxItem
          key={option.value}
          id={option.value}
          textValue={option.label}
          className={({ isSelected }) => `custom-select-option${isSelected ? " selected" : ""}`}
        >{({ isSelected }) => <><span>{option.label}</span>{isSelected && <Check size={14} />}</>}</ListBoxItem>)}
      </ListBox>
      {onAdd && <><div className="custom-select-divider" /><button className="custom-select-add" type="button" onClick={() => { setOpen(false); onAdd(); }}><span>+</span><span>{addLabel}</span></button></>}
    </Popover>
  </Select>;
}
