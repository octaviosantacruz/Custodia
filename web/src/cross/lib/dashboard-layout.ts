// Personal dashboard visual layout: a fixed 3x2 grid of 6 zones (0-5, row-major),
// matching the CHECK enforced server-side by DashboardWidget in
// backend/app/schemas.py. Widgets are placed by size + preferred zone; when
// a placement is missing or collides with another widget, we auto-flow it
// into the first zone that still fits, in widget order.

export type DashboardWidgetSize = 'sm' | 'md' | 'lg';

export const DASHBOARD_ZONE_COLUMNS = 3;
export const DASHBOARD_ZONE_ROWS = 2;
export const DASHBOARD_ZONE_COUNT = DASHBOARD_ZONE_COLUMNS * DASHBOARD_ZONE_ROWS;

export const DASHBOARD_SIZE_SPANS: Record<DashboardWidgetSize, { cols: number; rows: number }> = {
  sm: { cols: 1, rows: 1 },
  md: { cols: 2, rows: 1 },
  lg: { cols: 2, rows: 2 },
};

export const DASHBOARD_SIZE_LABELS: Record<DashboardWidgetSize, string> = {
  sm: t('Pequeño'),
  md: 'Ancho',
  lg: 'Grande',
};

export const DASHBOARD_SIZE_HINTS: Record<DashboardWidgetSize, string> = {
  sm: '1 zona',
  md: t('2 zonas en fila'),
  lg: '4 zonas (2×2)',
};

export function dashboardZoneFits(position: number, size: DashboardWidgetSize): boolean {
  if (position < 0 || position >= DASHBOARD_ZONE_COUNT) return false;
  const { cols, rows } = DASHBOARD_SIZE_SPANS[size];
  const col = position % DASHBOARD_ZONE_COLUMNS;
  const row = Math.floor(position / DASHBOARD_ZONE_COLUMNS);
  return col + cols <= DASHBOARD_ZONE_COLUMNS && row + rows <= DASHBOARD_ZONE_ROWS;
}

export function dashboardZonesCovered(position: number, size: DashboardWidgetSize): number[] {
  const { cols, rows } = DASHBOARD_SIZE_SPANS[size];
  const col = position % DASHBOARD_ZONE_COLUMNS;
  const row = Math.floor(position / DASHBOARD_ZONE_COLUMNS);
  const zones: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) zones.push((row + r) * DASHBOARD_ZONE_COLUMNS + (col + c));
  }
  return zones;
}

export type DashboardLayoutItem<T> = { widget: T; position: number; size: DashboardWidgetSize };

/** Grid cell of a resolved widget; PAM and Netskope boards both place charts with it. */
export function dashboardGridPlacement(position: number, size: DashboardWidgetSize): { gridColumn: string; gridRow: string } {
  const { cols, rows } = DASHBOARD_SIZE_SPANS[size];
  const col = position % DASHBOARD_ZONE_COLUMNS;
  const row = Math.floor(position / DASHBOARD_ZONE_COLUMNS);
  return { gridColumn: `${col + 1} / span ${cols}`, gridRow: `${row + 1} / span ${rows}` };
}

function resolveLayout<T extends { position?: number | null; size?: DashboardWidgetSize | string | null }>(
  widgets: T[],
  maxRows: number,
): DashboardLayoutItem<T>[] {
  const maxZones = DASHBOARD_ZONE_COLUMNS * maxRows;
  const fits = (position: number, size: DashboardWidgetSize) => {
    if (position < 0 || position >= maxZones) return false;
    const { cols, rows } = DASHBOARD_SIZE_SPANS[size];
    const col = position % DASHBOARD_ZONE_COLUMNS;
    const row = Math.floor(position / DASHBOARD_ZONE_COLUMNS);
    return col + cols <= DASHBOARD_ZONE_COLUMNS && row + rows <= maxRows;
  };
  const coveredZones = (position: number, size: DashboardWidgetSize) => {
    const { cols, rows } = DASHBOARD_SIZE_SPANS[size];
    const col = position % DASHBOARD_ZONE_COLUMNS;
    const row = Math.floor(position / DASHBOARD_ZONE_COLUMNS);
    const zones: number[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) zones.push((row + r) * DASHBOARD_ZONE_COLUMNS + (col + c));
    }
    return zones;
  };
  const occupied = new Set<number>();
  const resolved: DashboardLayoutItem<T>[] = [];
  for (const widget of widgets) {
    const size: DashboardWidgetSize = widget.size === 'md' || widget.size === 'lg' ? widget.size : 'sm';
    const preferred = typeof widget.position === 'number' ? widget.position : null;
    const candidates: number[] = [];
    if (preferred !== null) candidates.push(preferred);
    for (let zone = 0; zone < maxZones; zone += 1) if (zone !== preferred) candidates.push(zone);
    let placedAt: number | null = null;
    for (const zone of candidates) {
      if (!fits(zone, size)) continue;
      const zones = coveredZones(zone, size);
      if (zones.some((covered) => occupied.has(covered))) continue;
      zones.forEach((covered) => occupied.add(covered));
      placedAt = zone;
      break;
    }
    resolved.push({ widget, position: placedAt ?? preferred ?? 0, size });
  }
  return resolved;
}

/**
 * Resolves final grid placement for a list of widgets, honoring each
 * widget's preferred `position`/`size` when it is free, and otherwise
 * placing it in the first zone (in widget order) that fits without
 * overlapping an already-placed widget. Used both by the customizer's zone
 * picker preview and the actual dashboard grid, so both stay in sync.
 */
export function resolveDashboardLayout<T extends { position?: number | null; size?: DashboardWidgetSize | string | null }>(
  widgets: T[],
): DashboardLayoutItem<T>[] {
  return resolveLayout(widgets, DASHBOARD_ZONE_ROWS);
}

/**
 * The editor intentionally offers a compact 3×2 placement picker. The
 * dashboard itself must still render every saved visual block: when their
 * combined spans exceed those six zones, it adds rows and auto-flows the
 * overflow instead of placing multiple widgets in the same cell.
 */
export function resolveDashboardRenderLayout<T extends { position?: number | null; size?: DashboardWidgetSize | string | null }>(
  widgets: T[],
): DashboardLayoutItem<T>[] {
  const requiredRows = Math.max(DASHBOARD_ZONE_ROWS, widgets.reduce((rows, widget) => {
    const size = widget.size === 'md' || widget.size === 'lg' ? widget.size : 'sm';
    return rows + DASHBOARD_SIZE_SPANS[size].rows;
  }, 0));
  return resolveLayout(widgets, requiredRows);
}

/** Zones already covered by other widgets, excluding `excludeIndex`. Used by the zone picker to grey out taken zones for the widget being edited. */
export function dashboardOccupiedZones<T extends { position?: number | null; size?: DashboardWidgetSize | string | null }>(
  widgets: T[],
  excludeIndex: number,
): Set<number> {
  const others = widgets.filter((_, index) => index !== excludeIndex);
  const resolved = resolveDashboardLayout(others);
  const occupied = new Set<number>();
  resolved.forEach((item) => dashboardZonesCovered(item.position, item.size).forEach((zone) => occupied.add(zone)));
  return occupied;
}

/** Swap two widgets' grid positions and their order in the list, so an
 * in-place reorder moves both explicit placements and auto-flow order. */
export function swapDashboardWidgets<T extends { widget_id: string; position?: number | null }>(
  widgets: T[],
  idA: string,
  idB: string,
): T[] {
  const from = widgets.findIndex((widget) => widget.widget_id === idA);
  const to = widgets.findIndex((widget) => widget.widget_id === idB);
  if (from < 0 || to < 0 || from === to) return widgets;
  const next = widgets.map((widget) => ({ ...widget }));
  const positionFrom = next[from].position ?? null;
  next[from].position = next[to].position ?? null;
  next[to].position = positionFrom;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Move a widget one position earlier/later among the widgets accepted by
 * `sameGroup`, without touching positions (auto-flow follows list order). */
export function moveDashboardWidget<T extends { widget_id: string }>(
  widgets: T[],
  id: string,
  direction: -1 | 1,
  sameGroup: (widget: T) => boolean,
): T[] {
  const indices = widgets
    .map((widget, index) => (sameGroup(widget) ? index : -1))
    .filter((index) => index >= 0);
  const position = indices.findIndex((index) => widgets[index].widget_id === id);
  const target = position + direction;
  if (position < 0 || target < 0 || target >= indices.length) return widgets;
  const next = [...widgets];
  const from = indices[position];
  const to = indices[target];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

import { t } from '../i18n/index.ts';