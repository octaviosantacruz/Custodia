import assert from 'node:assert/strict';
import test from 'node:test';

import { parseConnectionInventoryCsv } from '../../src/cross/lib/connection-inventory-csv.ts';

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

test('reads the exported columns back: Sí/No, empty as no data, the observed columns ignored and the formula prefix undone', () => {
  const rows = parseConnectionInventoryCsv([
    'Instance Name,Ambiente,Private IP,Puerto,CA SIA,CA DBA,Implementado ZSP,Tengo acceso,Descripción,Estado,Cuentas en Safes,Políticas SIA,Cobertura observada',
    "srv-1,PROD,10.0.0.1,22,Sí,No,,Sí,'=HYPERLINK(1),Activo,2,1,Safe + SIA",
  ].join('\n'));
  assert.deepEqual(rows[0], {
    source_row_number: 2, instance_name: 'srv-1', environment: 'PROD', private_ip: '10.0.0.1', port: 22,
    ca_sia: true, ca_dba: false, zsp_implemented: null, access_available: true, description: '=HYPERLINK(1)',
  });
});

test('reads the "Tengo Llegada?" column of the current sheet as access', () => {
  const rows = parseConnectionInventoryCsv([
    'Instance Name,Ambiente,Private IP,Puerto,CA_SIA,CA_DBA,Implementado ZSP,Tengo Llegada?',
    'fo-ftp01-srv,PROD,172.20.20.153,22,NO,Sí,NO,NO',
  ].join('\n'));
  assert.equal(rows[0].access_available, false);
  assert.equal(rows[0].ca_dba, true);
});

test('reads Platform and DBA headers as the CA SIA and CA DBA flags', () => {
  const rows = parseConnectionInventoryCsv([
    'Instance Name,Ambiente,Private IP,Puerto,Platform,DBA',
    'srv-1,PROD,10.0.0.1,22,Sí,No',
  ].join('\n'));
  assert.equal(rows[0].ca_sia, true);
  assert.equal(rows[0].ca_dba, false);
});
