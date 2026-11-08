import assert from 'node:assert/strict';
import test from 'node:test';
import { netskopeEventLabel } from '../../../src/netskope/sse/lib/netskope-event-labels.ts';

test('known Netskope event literals have exact Spanish labels and retain their source literal', () => {
  const labels = [
    ['Uninstalled', 'Cliente desinstalado'],
    ['Disconnected By Uninstall', 'Desconectado por desinstalación'],
    ['Admin Disabled', 'Deshabilitado por un administrador'],
    ['Installed', 'Cliente instalado'],
    ['Tunnel Up', 'Túnel activo'],
    ['Tunnel Down', 'Túnel caído'],
    ['Tunnel down due to error', 'Túnel caído por error'],
    ['Tunnel down due to error in Modern Standby mode', 'Túnel caído por error en Modern Standby'],
    ['System Shutdown', 'Apagado del sistema'],
    ['System power-up', 'Encendido del sistema'],
    ['Dem Heartbeat', 'Heartbeat de DEM'],
    ['unknown', 'Evento desconocido'],
  ] as const;

  for (const [literal, label] of labels) {
    assert.deepEqual(netskopeEventLabel(literal), { label, literal, known: true });
  }
});

test('event labels are exact and case-sensitive; unknown values are preserved verbatim', () => {
  for (const literal of ['uninstalled', ' Tunnel Down', 'Tunnel Down ', 'tunnel down', 'Tunnel  Down', 'Tunnel Down!', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.deepEqual(netskopeEventLabel(literal), { label: literal, literal, known: false });
  }
});
