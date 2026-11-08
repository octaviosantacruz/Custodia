import { useState } from 'react';
import { parseDate, type CalendarDate } from '@internationalized/date';
import {
  Button, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, DateInput, DateRangePicker,
  DateSegment, Dialog, Group, Heading, I18nProvider, Popover, RangeCalendar,
} from 'react-aria-components';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import './date-range-field.css';

export type DateRange = { start: string; end: string };
export type DateRangePreset = { label: string; range: DateRange };

type Props = {
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
  /** Inclusive bounds as YYYY-MM-DD. */
  min?: string;
  max?: string;
  presets?: DateRangePreset[];
};

const toDate = (value: string | undefined) => {
  try { return value ? parseDate(value) : undefined; } catch { return undefined; }
};

/* A date range in Custodia's own style: React Aria Components owns typing per segment, the keyboard, focus and
   the popover; Custodia keeps classes and tokens (the same surface as CompactSelect). The browser's native date
   picker cannot be themed, so it is not used. Spanish, weeks start on Monday, values travel as YYYY-MM-DD. */
export function DateRangeField({ label, value, onChange, min, max, presets = [] }: Props) {
  const [open, setOpen] = useState(false);
  const start = toDate(value.start);
  const end = toDate(value.end);
  return <I18nProvider locale="es-AR">
    <DateRangePicker
      className="date-range-field" aria-label={label} firstDayOfWeek="mon"
      value={start && end ? { start, end } : null}
      minValue={toDate(min)} maxValue={toDate(max)}
      isOpen={open} onOpenChange={setOpen}
      onChange={(range) => { if (range) onChange({ start: range.start.toString(), end: range.end.toString() }); }}
    >
      <Group className="date-range-field-group">
        <DateInput slot="start" className="date-range-field-input">{(segment) => <DateSegment className="date-range-field-segment" segment={segment} />}</DateInput>
        <span className="date-range-field-dash" aria-hidden>–</span>
        <DateInput slot="end" className="date-range-field-input">{(segment) => <DateSegment className="date-range-field-segment" segment={segment} />}</DateInput>
        <Button className="date-range-field-trigger" aria-label="Abrir calendario"><CalendarDays size={14} aria-hidden /></Button>
      </Group>
      <Popover className="date-range-field-popover" offset={6} placement="bottom end">
        <Dialog className="date-range-field-dialog" aria-label={label}>
          <RangeCalendar className="date-range-field-calendar">
            <header className="date-range-field-header">
              <Button slot="previous" className="date-range-field-nav" aria-label="Mes anterior"><ChevronLeft size={15} aria-hidden /></Button>
              <Heading className="date-range-field-heading" />
              <Button slot="next" className="date-range-field-nav" aria-label="Mes siguiente"><ChevronRight size={15} aria-hidden /></Button>
            </header>
            <CalendarGrid className="date-range-field-grid">
              <CalendarGridHeader>{(day) => <CalendarHeaderCell className="date-range-field-weekday">{day}</CalendarHeaderCell>}</CalendarGridHeader>
              <CalendarGridBody>{(date: CalendarDate) => <CalendarCell date={date} className="date-range-field-cell" />}</CalendarGridBody>
            </CalendarGrid>
          </RangeCalendar>
          {presets.length ? <div className="date-range-field-presets">
            {presets.map((preset) => <button key={preset.label} type="button" className="date-range-field-preset"
              onClick={() => { onChange(preset.range); setOpen(false); }}>{preset.label}</button>)}
          </div> : null}
        </Dialog>
      </Popover>
    </DateRangePicker>
  </I18nProvider>;
}
