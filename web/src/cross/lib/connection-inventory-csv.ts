import type { ConnectionInventoryImportRow } from '../types/connection';
import { parseWorkStatus } from './connection-work.ts';
import { t } from '../i18n/index.ts';

type Field = keyof Omit<ConnectionInventoryImportRow, 'source_row_number'>;

const HEADER_ALIASES: Record<Field, string[]> = {
  instance_name: ['instance name', 'instance_name', 'nombre instancia', t('nombre de instancia')],
  environment: ['ambiente', 'environment', 'entorno'],
  private_ip: ['private ip', 'private_ip', 'ip privada', 'ip'],
  port: ['puerto', 'port'],
  ca_sia: ['platform', 'ca platform', 'acceso platform', 'ca sia', 'ca_sia', 'sia'],
  ca_dba: ['dba', 'ca dba', 'acceso dba', 'ca_dba'],
  zsp_implemented: ['implementado zsp', 'implementado zsp?', 'zsp'],
  access_available: ['tengo acceso', 'tengo acceso?', 'tengo llegada', 'tengo llegada?', 'llegada', 'access', 'acceso'],
  description: [t('descripción'), 'descripcion', 'description'],
  work_status: [t('estado de trabajo'), 'estado trabajo', 'work status'],
  responsible: ['responsable', 'responsible'],
  note: ['nota', 'notas', 'note'],
};

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[?¿]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted;
    } else if (character === separator && !quoted) {
      cells.push(current.trim()); current = '';
    } else current += character;
  }
  cells.push(current.trim());
  return cells;
}

function separatorFor(header: string): string {
  const candidates = [',', ';', '\t'];
  return candidates.sort((a, b) => parseCsvLine(header, b).length - parseCsvLine(header, a).length)[0];
}

function booleanValue(value: string): boolean | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (['n/a', 'na', 'n.a', 'no aplica', t('sin dato'), 's/d', '-', '--'].includes(normalized)) return null;
  if (['si', 's', 'yes', 'y', 'true', '1'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0'].includes(normalized)) return false;
  throw new Error(`Valor booleano no reconocido: "${value}"`);
}

/** The export prefixes a cell that starts with = + - @ with an apostrophe so a spreadsheet never runs it; undo it. */
function unescapeFormula(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function headerIndex(headers: string[], field: Field): number {
  const aliases = HEADER_ALIASES[field].map(normalizeHeader);
  return headers.findIndex((header) => aliases.includes(header));
}

/** State, responsible and note only travel when the file has the column and the cell has a value. */
function optionalColumns(headers: string[], cells: string[], valueAt: (cells: string[], field: Field) => string, rowNumber: number) {
  const extra: Pick<ConnectionInventoryImportRow, 'work_status' | 'responsible' | 'note'> = {};
  if (headerIndex(headers, 'work_status') >= 0) {
    try { const status = parseWorkStatus(valueAt(cells, 'work_status')); if (status) extra.work_status = status; }
    catch (error) { throw new Error(`${error instanceof Error ? error.message : t('Estado de trabajo inválido')} (fila ${rowNumber}).`); }
  }
  const responsible = valueAt(cells, 'responsible');
  if (responsible) extra.responsible = responsible;
  const note = valueAt(cells, 'note');
  if (note) extra.note = note;
  return extra;
}

export function parseConnectionInventoryCsv(text: string): ConnectionInventoryImportRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('El CSV debe tener encabezados y al menos una conexión.');
  const separator = separatorFor(lines[0]);
  const headers = parseCsvLine(lines[0], separator).map(normalizeHeader);
  const instanceIndex = headerIndex(headers, 'instance_name');
  const ipIndex = headerIndex(headers, 'private_ip');
  if (instanceIndex < 0 || ipIndex < 0) throw new Error('El CSV debe incluir las columnas Instance Name y Private IP.');
  const valueAt = (cells: string[], field: Field): string => {
    const index = headerIndex(headers, field);
    return index >= 0 ? unescapeFormula(cells[index] || '') : '';
  };
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line, separator);
    const portText = valueAt(cells, 'port');
    const port = portText ? Number(portText) : null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error(`Puerto inválido en la fila ${index + 2}.`);
    const instanceName = valueAt(cells, 'instance_name');
    const privateIp = valueAt(cells, 'private_ip');
    if (!instanceName || !privateIp) throw new Error(`Falta Instance Name o Private IP en la fila ${index + 2}.`);
    return {
      source_row_number: index + 2,
      instance_name: instanceName,
      environment: valueAt(cells, 'environment'),
      private_ip: privateIp,
      port,
      ca_sia: booleanValue(valueAt(cells, 'ca_sia')),
      ca_dba: booleanValue(valueAt(cells, 'ca_dba')),
      zsp_implemented: booleanValue(valueAt(cells, 'zsp_implemented')),
      access_available: booleanValue(valueAt(cells, 'access_available')),
      description: valueAt(cells, 'description'),
      ...optionalColumns(headers, cells, valueAt, index + 2),
    };
  });
}
