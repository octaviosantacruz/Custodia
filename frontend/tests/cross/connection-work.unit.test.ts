import assert from 'node:assert/strict';
import test from 'node:test';

import { describeChange, parseWorkStatus, workLabel } from '../../src/cross/lib/connection-work.ts';
import { parseConnectionInventoryCsv } from '../../src/cross/lib/connection-inventory-csv.ts';

test('reads a work state by its Spanish label, accents and case aside, or by code', () => {
  assert.equal(parseWorkStatus('En curso'), 'in_progress');
  assert.equal(parseWorkStatus('  INCORPORADO '), 'onboarded');
  assert.equal(parseWorkStatus('no aplica'), 'not_applicable');
  assert.equal(parseWorkStatus('blocked'), 'blocked');
  assert.equal(parseWorkStatus(''), null);
  assert.throws(() => parseWorkStatus('hecho'), /no reconocido/);
  assert.equal(workLabel('pending'), 'Pendiente');
});

test('a sheet without the work columns sends none of them, so an import never resets what people set', () => {
  const [row] = parseConnectionInventoryCsv('Instance Name,Ambiente,Private IP,Puerto\nsrv-1,PROD,10.0.0.1,22');
  assert.equal('work_status' in row, false);
  assert.equal('responsible' in row, false);
  assert.equal('note' in row, false);
});

test('a sheet with the work columns sends only the cells that have a value', () => {
  const rows = parseConnectionInventoryCsv([
    'Instance Name,Ambiente,Private IP,Puerto,Estado de trabajo,Responsable,Nota',
    'srv-1,PROD,10.0.0.1,22,Bloqueado,Ana,Sin ventana',
    'srv-2,PROD,10.0.0.2,22,,,',
  ].join('\n'));
  assert.deepEqual([rows[0].work_status, rows[0].responsible, rows[0].note], ['blocked', 'Ana', 'Sin ventana']);
  assert.equal('work_status' in rows[1] || 'responsible' in rows[1], false);
});

test('an unknown state in the sheet names the row', () => {
  assert.throws(() => parseConnectionInventoryCsv('Instance Name,Ambiente,Private IP,Puerto,Estado de trabajo\nsrv-1,PROD,10.0.0.1,22,hecho'), /fila 2/);
});

test('an audit event reads as short sentences with before and after', () => {
  assert.deepEqual(describeChange({ work_status: 'pending' }, { work_status: 'in_progress' }), ['Trabajo: Pendiente → En curso']);
  assert.deepEqual(describeChange(null, { responsible: 'Ana', ca_sia: true }), ['Responsable: Ana', 'Platform: Sí']);
});
