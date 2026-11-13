import type { ChainDirection, ChainHop, ChainNode, ChainNodeType, ChainRelation } from './chains-api';
import { t } from '../i18n/index.ts';

/* Cadenas as fixed columns: every node type lands in its own column, so the
   same map works whether the walk starts at a user, a Safe or a PSM. The path
   is a contiguous run of selected cells around the root; each column next to
   the path lists the neighbours of its inner selected node. Pure helpers only
   (no runtime imports) so node --test can exercise them directly. */

export type ChainColumnSpec = {
  key: string;
  label: string;
  types: ChainNodeType[];
};

export const PAM_CHAIN_COLUMNS: ChainColumnSpec[] = [
  { key: 'user', label: t('Usuario PAM'), types: ['user'] },
  { key: 'role', label: 'Rol', types: ['role'] },
  { key: 'safe', label: 'Safe', types: ['safe'] },
  { key: 'platform', label: 'Plataforma', types: ['platform'] },
  { key: 'target', label: 'PSM · Asset Access', types: ['psm', 'access_asset'] },
];

/* With an Identity read permission the first column is the person: the Identity
   user and their PAM account are one node, and the account ids live inside its
   card. Same node type and same hops, only the column title changes. */
export const PAM_IDENTITY_CHAIN_COLUMNS: ChainColumnSpec[] = [
  { ...PAM_CHAIN_COLUMNS[0], label: 'Identidad' },
  ...PAM_CHAIN_COLUMNS.slice(1),
];

export type ChainPathCell = {
  node: ChainNode;
  /** Relation towards the neighbour closer to the root; null for the root. */
  relation: ChainRelation | null;
};

export type ChainPath = {
  rootIndex: number;
  cells: Record<number, ChainPathCell>;
};

export type ChainTarget = { type: ChainNodeType; id: number };

export type ChainColumnSource = {
  node: ChainNode;
  direction: ChainDirection;
};

export function columnIndexOf(columns: ChainColumnSpec[], type: ChainNodeType): number {
  return columns.findIndex((column) => column.types.includes(type));
}

export function createPath(columns: ChainColumnSpec[], node: ChainNode): ChainPath | null {
  const index = columnIndexOf(columns, node.type);
  if (index < 0) return null;
  return { rootIndex: index, cells: { [index]: { node, relation: null } } };
}

export function pathRange(path: ChainPath): { lo: number; hi: number } {
  let lo = path.rootIndex;
  let hi = path.rootIndex;
  while (path.cells[lo - 1]) lo -= 1;
  while (path.cells[hi + 1]) hi += 1;
  return { lo, hi };
}

/** Selected cells ordered left to right (the visual chain). */
export function orderedPath(path: ChainPath): ChainPathCell[] {
  const { lo, hi } = pathRange(path);
  const cells: ChainPathCell[] = [];
  for (let index = lo; index <= hi; index += 1) cells.push(path.cells[index]);
  return cells;
}

/**
 * Which node feeds a column and in which direction. Columns right of the root
 * list forward neighbours of their left cell; columns left of it list back
 * neighbours of their right cell. Null when the column is out of reach.
 */
export function columnSource(path: ChainPath, columnIndex: number): ChainColumnSource | null {
  if (columnIndex === path.rootIndex) return null;
  if (columnIndex > path.rootIndex) {
    const inner = path.cells[columnIndex - 1];
    return inner ? { node: inner.node, direction: 'forward' } : null;
  }
  const inner = path.cells[columnIndex + 1];
  return inner ? { node: inner.node, direction: 'back' } : null;
}

/** Cells beyond `columnIndex` on the side away from the root. */
function withoutOuterCells(path: ChainPath, columnIndex: number, keepColumn: boolean): ChainPath {
  const cells: Record<number, ChainPathCell> = {};
  for (const [key, cell] of Object.entries(path.cells)) {
    const index = Number(key);
    const outward = columnIndex > path.rootIndex ? index > columnIndex : index < columnIndex;
    const isColumn = index === columnIndex;
    if (outward || (isColumn && !keepColumn)) continue;
    cells[index] = cell;
  }
  return { rootIndex: path.rootIndex, cells };
}

/**
 * Select a neighbour in a reachable column. Replacing a selection drops the
 * cells beyond it, because their relation hung on the replaced node.
 */
export function selectInColumn(path: ChainPath, columnIndex: number, hop: ChainHop): ChainPath {
  if (columnIndex === path.rootIndex || !columnSource(path, columnIndex)) return path;
  const trimmed = withoutOuterCells(path, columnIndex, false);
  const { relation, ...node } = hop;
  return {
    rootIndex: trimmed.rootIndex,
    cells: { ...trimmed.cells, [columnIndex]: { node, relation } },
  };
}

/** Remove a selection (and everything beyond it); the root cannot be removed. */
export function clearColumn(path: ChainPath, columnIndex: number): ChainPath {
  if (columnIndex === path.rootIndex || !path.cells[columnIndex]) return path;
  return withoutOuterCells(path, columnIndex, false);
}

/** Link between column `leftIndex` and `leftIndex + 1`, if both are selected. */
export function linkRelation(path: ChainPath, leftIndex: number): ChainRelation | null {
  const left = path.cells[leftIndex];
  const right = path.cells[leftIndex + 1];
  if (!left || !right) return null;
  // The outer cell carries the relation towards the root side.
  return leftIndex + 1 > path.rootIndex ? right.relation : left.relation;
}

/** Split an expansion into hops that belong to the column and lateral ones (e.g. SIA). */
export function splitColumnHops(
  columns: ChainColumnSpec[],
  columnIndex: number,
  hops: ChainHop[],
): { inColumn: ChainHop[]; lateral: ChainHop[] } {
  const types = columns[columnIndex]?.types ?? [];
  return {
    inColumn: hops.filter((hop) => types.includes(hop.type)),
    lateral: hops.filter((hop) => !types.includes(hop.type)),
  };
}

export function serializePath(path: ChainPath): string {
  return orderedPath(path)
    .filter((cell) => cell.node.id > 0)
    .map((cell) => `${cell.node.type}:${cell.node.id}`)
    .join('>');
}

export function buildPathQuery(path: ChainPath): string {
  const root = path.cells[path.rootIndex].node;
  const params = new URLSearchParams();
  params.set('type', root.type);
  params.set('id', String(root.id));
  if (orderedPath(path).length > 1) params.set('trail', serializePath(path));
  return params.toString();
}

/**
 * Parse a shared link into column-placed targets. Accepts the current format
 * and the previous `?type&id&dir&trail` explorer links: placement depends on
 * each node's type, not on the order it was walked. Invalid or gapped chains
 * fall back to the root alone; unknown roots return null.
 */
export function parsePathQuery(
  columns: ChainColumnSpec[],
  search: string,
): { root: ChainTarget; targets: Record<number, ChainTarget> } | null {
  const params = new URLSearchParams(search);
  const rawType = params.get('type');
  const id = Number(params.get('id'));
  if (!rawType || !Number.isInteger(id) || id <= 0) return null;
  const rootType = rawType as ChainNodeType;
  const rootIndex = columnIndexOf(columns, rootType);
  if (rootIndex < 0) return null;
  const root = { type: rootType, id };
  const only = { root, targets: { [rootIndex]: root } };

  const rawTrail = params.get('trail');
  if (!rawTrail) return only;
  const targets: Record<number, ChainTarget> = {};
  for (const part of rawTrail.split('>')) {
    const [type, rawId] = part.split(':');
    const targetId = Number(rawId);
    const index = columnIndexOf(columns, type as ChainNodeType);
    if (index < 0 || !Number.isInteger(targetId) || targetId <= 0 || targets[index]) return only;
    targets[index] = { type: type as ChainNodeType, id: targetId };
  }
  const rootTarget = targets[rootIndex];
  if (!rootTarget || rootTarget.type !== root.type || rootTarget.id !== root.id) return only;
  const indexes = Object.keys(targets).map(Number).sort((a, b) => a - b);
  for (let position = 1; position < indexes.length; position += 1) {
    if (indexes[position] !== indexes[position - 1] + 1) return only;
  }
  return { root, targets };
}

/** Human copy for an unreachable column, e.g. "Se habilita al elegir en Rol." */
export function unreachableHint(columns: ChainColumnSpec[], path: ChainPath, columnIndex: number): string {
  const neighbor = columnIndex > path.rootIndex ? columnIndex - 1 : columnIndex + 1;
  return t('Se habilita al elegir en {neighbor}.', { neighbor: columns[neighbor].label });
}
