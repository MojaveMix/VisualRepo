import type { ErEntity, ErRelation, ErRelationType } from '../types/api';

export const ER_NODE_WIDTH = 252;
export const ER_HEADER_HEIGHT = 50;
export const ER_ROW_HEIGHT = 26;
const ER_PADDING_BOTTOM = 8;
const COL_GAP = 90;
const ROW_GAP = 80;
const PER_ROW = 3;

export type Side = 'top' | 'bottom' | 'left' | 'right';

export function entityHeight(entity: ErEntity): number {
  return ER_HEADER_HEIGHT + entity.columns.length * ER_ROW_HEIGHT + ER_PADDING_BOTTOM;
}

export interface ErLayout {
  positions: Map<string, { x: number; y: number }>;
  /** Row index of every entity (used to choose which side an edge leaves from). */
  rows: Map<string, number>;
}

/**
 * Places tables in a grid. Tables are ordered by walking the relationship graph
 * (most connected first) so related tables end up next to each other.
 */
export function layoutEntities(entities: ErEntity[], relations: ErRelation[]): ErLayout {
  const ids = new Set(entities.map((e) => e.id));
  const adjacency = new Map<string, Set<string>>();
  entities.forEach((e) => adjacency.set(e.id, new Set()));
  for (const r of relations) {
    if (r.source !== r.target && ids.has(r.source) && ids.has(r.target)) {
      adjacency.get(r.source)!.add(r.target);
      adjacency.get(r.target)!.add(r.source);
    }
  }

  const byDegree = [...entities].sort(
    (a, b) =>
      adjacency.get(b.id)!.size - adjacency.get(a.id)!.size ||
      a.tableName.localeCompare(b.tableName)
  );

  const ordered: ErEntity[] = [];
  const seen = new Set<string>();
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const start of byDegree) {
    if (seen.has(start.id)) continue;
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      ordered.push(byId.get(id)!);
      const neighbours = [...adjacency.get(id)!]
        .filter((n) => !seen.has(n))
        .sort(
          (a, b) =>
            adjacency.get(b)!.size - adjacency.get(a)!.size ||
            byId.get(a)!.tableName.localeCompare(byId.get(b)!.tableName)
        );
      for (const n of neighbours) {
        seen.add(n);
        queue.push(n);
      }
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  const rows = new Map<string, number>();
  let y = 0;
  for (let start = 0; start < ordered.length; start += PER_ROW) {
    const rowEntities = ordered.slice(start, start + PER_ROW);
    const rowIndex = start / PER_ROW;
    rowEntities.forEach((e, i) => {
      positions.set(e.id, { x: i * (ER_NODE_WIDTH + COL_GAP), y });
      rows.set(e.id, rowIndex);
    });
    y += Math.max(...rowEntities.map(entityHeight)) + ROW_GAP;
  }

  return { positions, rows };
}

/** Which side of the source/target tables an edge should attach to. */
export function edgeSides(
  source: { x: number; y: number },
  target: { x: number; y: number },
  sourceRow: number,
  targetRow: number
): { sourceSide: Side; targetSide: Side } {
  if (sourceRow !== targetRow) {
    return targetRow > sourceRow
      ? { sourceSide: 'bottom', targetSide: 'top' }
      : { sourceSide: 'top', targetSide: 'bottom' };
  }
  return target.x >= source.x
    ? { sourceSide: 'right', targetSide: 'left' }
    : { sourceSide: 'left', targetSide: 'right' };
}

export const CARDINALITY: Record<ErRelationType, string> = {
  MANY_TO_ONE: 'N : 1',
  ONE_TO_MANY: '1 : N',
  ONE_TO_ONE: '1 : 1',
  MANY_TO_MANY: 'N : M',
};

/** Plain-English description of a relationship from the point of view of one table. */
export function describeRelation(
  rel: ErRelation,
  perspectiveId: string,
  nameOf: (id: string) => string
): string {
  const source = nameOf(rel.source);
  const target = nameOf(rel.target);
  const asSource = rel.source === perspectiveId;
  const via = rel.joinColumn ? ` (column ${rel.joinColumn})` : '';
  switch (rel.type) {
    case 'MANY_TO_ONE':
      return asSource
        ? `Each ${source} belongs to one ${target}${via}`
        : `Many ${source} rows point to one ${target}${via}`;
    case 'ONE_TO_MANY':
      return asSource
        ? `Each ${source} has many ${target}${via}`
        : `Each ${target} belongs to one ${source}${via}`;
    case 'ONE_TO_ONE':
      return asSource
        ? `Each ${source} has one ${target}${via}`
        : `Each ${target} has one ${source}${via}`;
    case 'MANY_TO_MANY':
      return `${source} and ${target} are linked many-to-many${
        rel.joinTable ? ` through table ${rel.joinTable}` : ''
      }`;
    default:
      return `${source} relates to ${target}`;
  }
}
