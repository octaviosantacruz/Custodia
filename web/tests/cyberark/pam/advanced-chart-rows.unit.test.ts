import assert from 'node:assert/strict';
import test from 'node:test';
import { advancedChartTable } from '../../../src/cyberark/pam/lib/advanced-chart-rows.ts';

test('scatter rows carry the label, both axes and the filter the chart click opens', () => {
  const table = advancedChartTable('scatter', { points: [{ key: 'a', label: 'Finance', x: 12, y: 3, filter_value: 'Finance' }, { key: 'b', label: 'Ops', x: 1, y: 1 }] });
  assert.deepEqual(table.columns, ['Elemento', 'Cuentas', 'Miembros']);
  assert.deepEqual(table.rows, [{ cells: ['Finance', '12', '3'], filterValue: 'Finance' }, { cells: ['Ops', '1', '1'], filterValue: undefined }]);
});

test('line and combo rows pair each period with every series and mark a missing value "Sin dato"', () => {
  const table = advancedChartTable('combo', { labels: ['2026-09', '2026-10'], filter_values: ['f1', 'f2'], series: [{ key: 's', label: 'Safes', values: [4, 5] }, { key: 'a', label: 'Cuentas', values: [10] }] });
  assert.deepEqual(table.columns, ['Período', 'Safes', 'Cuentas']);
  assert.deepEqual(table.rows[1], { cells: ['2026-10', '5', 'Sin dato'], filterValue: 'f2' });
});

test('heatmap rows name both dimensions and keep the cell filter', () => {
  const table = advancedChartTable('heatmap', { x_labels: ['A', 'B'], y_labels: ['pending'], cells: [{ x: 1, y: 0, value: 7, filter_value: 'pending|B' }] });
  assert.equal(table.rows[0].cells[1], 'B');
  assert.equal(table.rows[0].cells[2], '7');
  assert.equal(table.rows[0].filterValue, 'pending|B');
});

test('every point of a large scatter is a row (no silent cap)', () => {
  const points = Array.from({ length: 100 }, (_, index) => ({ key: `k${index}`, label: `Safe ${index}`, x: index, y: 1, filter_value: `f${index}` }));
  assert.equal(advancedChartTable('scatter', { points }).rows.length, 100);
});
