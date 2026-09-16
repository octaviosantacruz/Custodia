import assert from 'node:assert/strict';
import test from 'node:test';

import { parseConnectionInventoryCsv } from '../src/lib/connection-inventory-csv.ts';

test('parses the migration sheet columns and SI/NO coverage flags', () => {
  const rows = parseConnectionInventoryCsv([
    'Instance Name;Ambiente;Private IP;Puerto;CA_SIA;CA_DBA;Implementado ZSP?;Tengo Acceso?;Descripción',
    'dev-compute-db-desa;DEV;10.67.9.143;22;SI;NO;SI;SI;Servidor Linux',
  ].join('\n'));
  assert.deepEqual(rows[0], {
    source_row_number: 2,
    instance_name: 'dev-compute-db-desa', environment: 'DEV', private_ip: '10.67.9.143', port: 22,
    ca_sia: true, ca_dba: false, zsp_implemented: true, access_available: true, description: 'Servidor Linux',
  });
});

test('requires the IP and instance columns', () => {
  assert.throws(() => parseConnectionInventoryCsv('nombre;ambiente\nserver;DEV'), /Instance Name y Private IP/);
});

test('accepts N/A as an intentionally missing boolean value', () => {
  const rows = parseConnectionInventoryCsv([
    'Instance Name,Ambiente,Private IP,Puerto,CA_SIA,CA_DBA,Implementado ZSP?,Tengo Acceso?',
    'server-1,PROD,10.0.0.1,22,N/A,SI,N/A,SI',
  ].join('\n'));
  assert.equal(rows[0].ca_sia, null);
  assert.equal(rows[0].zsp_implemented, null);
  assert.equal(rows[0].ca_dba, true);
});
