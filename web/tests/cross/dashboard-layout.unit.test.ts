import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dashboardGridPlacement,
  dashboardOccupiedZones,
  dashboardZoneFits,
  dashboardZonesCovered,
  moveDashboardWidget,
  resolveDashboardLayout,
  resolveDashboardRenderLayout,
  swapDashboardWidgets,
} from '../../src/cross/lib/dashboard-layout.ts';

test('a small widget fits in every one of the 6 zones', () => {
  for (let zone = 0; zone < 6; zone += 1) assert.equal(dashboardZoneFits(zone, 'sm'), true);
});

test('a wide (2x1) widget cannot start in the last column of a row', () => {
  assert.equal(dashboardZoneFits(0, 'md'), true);
  assert.equal(dashboardZoneFits(2, 'md'), false);
  assert.equal(dashboardZoneFits(5, 'md'), false);
});

test('a large (2x2) widget only fits starting from the top-left 2x2 zones', () => {
  assert.equal(dashboardZoneFits(0, 'lg'), true);
  assert.equal(dashboardZoneFits(1, 'lg'), true);
  assert.equal(dashboardZoneFits(2, 'lg'), false);
  assert.equal(dashboardZoneFits(3, 'lg'), false);
  assert.equal(dashboardZoneFits(5, 'lg'), false);
});

test('dashboardZonesCovered reports every zone a placement occupies', () => {
  assert.deepEqual(dashboardZonesCovered(1, 'lg'), [1, 2, 4, 5]);
  assert.deepEqual(dashboardZonesCovered(3, 'md'), [3, 4]);
});

test('resolveDashboardLayout honors a widget preferred zone when it is free', () => {
  const widgets = [{ id: 'a', position: 5, size: 'sm' as const }];
  const [placed] = resolveDashboardLayout(widgets);
  assert.equal(placed.position, 5);
  assert.equal(placed.size, 'sm');
});

test('resolveDashboardLayout auto-flows a widget without a preferred zone into the first free zone', () => {
  const widgets = [
    { id: 'first', position: 0, size: 'sm' as const },
    { id: 'second', position: null, size: 'sm' as const },
  ];
  const resolved = resolveDashboardLayout(widgets);
  assert.equal(resolved[0].position, 0);
  assert.equal(resolved[1].position, 1);
});

test('resolveDashboardLayout resolves a collision by moving the later widget to the next free zone', () => {
  const widgets = [
    { id: 'first', position: 0, size: 'sm' as const },
    { id: 'second', position: 0, size: 'sm' as const },
  ];
  const resolved = resolveDashboardLayout(widgets);
  assert.equal(resolved[0].position, 0);
  assert.notEqual(resolved[1].position, 0);
});

test('render layout adds rows instead of stacking visual widgets after the 3x2 editor grid is full', () => {
  const widgets = Array.from({ length: 6 }, (_, index) => ({ id: `chart-${index}`, position: index, size: 'md' as const }));
  const resolved = resolveDashboardRenderLayout(widgets);
  const occupied = resolved.flatMap((item) => dashboardZonesCovered(item.position, item.size));
  assert.equal(new Set(occupied).size, occupied.length);
  assert.ok(resolved.some((item) => item.position >= 6));
});

test('dashboardOccupiedZones excludes the widget being edited from the occupied set', () => {
  const widgets = [
    { id: 'a', position: 0, size: 'sm' as const },
    { id: 'b', position: 1, size: 'sm' as const },
  ];
  const occupiedForB = dashboardOccupiedZones(widgets, 1);
  assert.equal(occupiedForB.has(0), true);
  assert.equal(occupiedForB.has(1), false);
});

test('swapDashboardWidgets trades positions and list order', () => {
  const widgets = [
    { widget_id: 'a', position: 0 },
    { widget_id: 'b', position: 4 },
    { widget_id: 'c', position: null },
  ];
  const swapped = swapDashboardWidgets(widgets, 'a', 'b');
  assert.deepEqual(swapped.map((widget) => widget.widget_id), ['b', 'a', 'c']);
  assert.equal(swapped[0].position, 0);
  assert.equal(swapped[1].position, 4);
  assert.deepEqual(swapDashboardWidgets(widgets, 'a', 'missing'), widgets);
});

test('swapDashboardWidgets reorders auto-flow widgets without inventing positions', () => {
  const widgets = [
    { widget_id: 'a', position: null },
    { widget_id: 'b', position: null },
  ];
  const swapped = swapDashboardWidgets(widgets, 'a', 'b');
  assert.deepEqual(swapped.map((widget) => widget.widget_id), ['b', 'a']);
  assert.equal(swapped[0].position, null);
  assert.equal(swapped[1].position, null);
});

test('moveDashboardWidget moves only within the accepted group', () => {
  const widgets = [
    { widget_id: 'data-1', kind: 'count' },
    { widget_id: 'chart-1', kind: 'chart' },
    { widget_id: 'data-2', kind: 'count' },
  ];
  const isCount = (widget: { kind: string }) => widget.kind === 'count';
  assert.deepEqual(moveDashboardWidget(widgets, 'data-2', -1, isCount).map((widget) => widget.widget_id), ['data-2', 'chart-1', 'data-1']);
  assert.deepEqual(moveDashboardWidget(widgets, 'data-1', -1, isCount).map((widget) => widget.widget_id), ['data-1', 'chart-1', 'data-2']);
  assert.deepEqual(moveDashboardWidget(widgets, 'chart-1', 1, isCount).map((widget) => widget.widget_id), ['data-1', 'chart-1', 'data-2']);
});

test('DASH-GRID-001: grid placement turns a resolved zone and size into the same CSS cell for every board', () => {
  assert.deepEqual(dashboardGridPlacement(0, 'md'), { gridColumn: '1 / span 2', gridRow: '1 / span 1' });
  assert.deepEqual(dashboardGridPlacement(2, 'sm'), { gridColumn: '3 / span 1', gridRow: '1 / span 1' });
  assert.deepEqual(dashboardGridPlacement(3, 'lg'), { gridColumn: '1 / span 2', gridRow: '2 / span 2' });
  // Widgets without a saved zone (Netskope) auto-flow: two wide charts never share a row.
  const flowed = resolveDashboardRenderLayout([{ size: 'md' }, { size: 'md' }]).map(({ position, size }) => dashboardGridPlacement(position, size));
  assert.deepEqual(flowed, [{ gridColumn: '1 / span 2', gridRow: '1 / span 1' }, { gridColumn: '1 / span 2', gridRow: '2 / span 1' }]);
});
