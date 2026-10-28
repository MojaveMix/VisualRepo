import type { GraphEdgeDto, GraphNodeDto } from '../types/api';
import {
  getLayerMeta,
  getRoleMeta,
  layerOrder,
  refineArchitecturalRole,
  resolveNodeLayerKey,
} from './archMeta';

export const NODE_WIDTH = 236;
export const COL_WIDTH = 276;
export const ROW_HEIGHT = 186;
const LANE_PADDING_X = 32;
const LANE_HEADER = 64;
const LANE_PADDING_BOTTOM = 22;
const LANE_GAP = 42;

export type ArchSide = 'top' | 'bottom' | 'left' | 'right';

export interface LaneRect {
  id: string;
  step: number;
  title: string;
  subtitle: string;
  color: string;
  count: number;
  roleBadges: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  positions: Map<string, { x: number; y: number }>;
  rows: Map<string, number>;
  lanes: LaneRect[];
}

/**
 * Computes an adaptive column count based on the largest layer so layers form
 * wide, balanced horizontal swimlanes rather than tall, narrow vertical stacks.
 */
function pickMaxCols(maxLayerCount: number): number {
  if (maxLayerCount <= 3) return 3;
  if (maxLayerCount <= 12) return 4;
  return 5;
}

/**
 * Places high-priority items in the center of a row and alternates left/right
 * so primary entrypoints and orchestrators align along the central vertical spine.
 */
function centerOutOrder<T>(sortedByPriority: T[]): T[] {
  if (sortedByPriority.length <= 2) return sortedByPriority;
  const result: T[] = new Array(sortedByPriority.length);
  const mid = Math.floor((sortedByPriority.length - 1) / 2);
  let left = mid;
  let right = mid + 1;
  sortedByPriority.forEach((item, idx) => {
    if (idx % 2 === 0) {
      result[left--] = item;
    } else {
      result[right++] = item;
    }
  });
  return result;
}

/**
 * Lays the architecture out as horizontal architectural layers stacked top-to-bottom,
 * with intra-layer topological sub-rows and barycenter alignment to minimize edge crossings.
 */
export function layoutGraph(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[] = []
): GraphLayout {
  const visibleIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => e.source !== e.target && visibleIds.has(e.source) && visibleIds.has(e.target)
  );

  // Adjacency maps across all visible nodes
  const incomingByNode = new Map<string, Set<string>>();
  const outgoingByNode = new Map<string, Set<string>>();
  for (const n of nodes) {
    incomingByNode.set(n.id, new Set());
    outgoingByNode.set(n.id, new Set());
  }
  for (const e of validEdges) {
    outgoingByNode.get(e.source)?.add(e.target);
    incomingByNode.get(e.target)?.add(e.source);
  }

  // Group nodes into resolved architectural layers
  const groups = new Map<string, GraphNodeDto[]>();
  const resolvedRoleById = new Map<string, string>();
  for (const n of nodes) {
    const role = refineArchitecturalRole(n.path, n.architecturalRole, n.language);
    resolvedRoleById.set(n.id, role);
    const tierKey = resolveNodeLayerKey(n);
    const list = groups.get(tierKey) ?? [];
    list.push(n);
    groups.set(tierKey, list);
  }

  const orderedTiers = [...groups.keys()].sort(
    (a, b) => layerOrder(a) - layerOrder(b) || a.localeCompare(b)
  );

  const maxLayerSize = Math.max(
    1,
    ...orderedTiers.map((t) => groups.get(t)!.length)
  );
  const maxCols = pickMaxCols(maxLayerSize);

  // First pass: organize each layer into ordered rows of nodes
  const layerRowsMap = new Map<string, GraphNodeDto[][]>();
  let widestRowCols = 1;

  for (const tier of orderedTiers) {
    const members = groups.get(tier)!;
    const memberIds = new Set(members.map((m) => m.id));

    // Build intra-layer directed graph
    const intraOut = new Map<string, Set<string>>();
    const intraIn = new Map<string, Set<string>>();
    for (const m of members) {
      intraOut.set(m.id, new Set());
      intraIn.set(m.id, new Set());
    }
    for (const e of validEdges) {
      if (memberIds.has(e.source) && memberIds.has(e.target)) {
        intraOut.get(e.source)!.add(e.target);
        intraIn.get(e.target)!.add(e.source);
      }
    }

    // Decide whether intra-layer dependencies warrant splitting into sub-levels:
    // Split into sub-levels if the layer already exceeds 1 row OR a hub node fans out to >= 2 peers in the same layer
    const hasIntraFanout = members.some((m) => (intraOut.get(m.id)?.size ?? 0) >= 2);
    const useSubLevels = members.length > maxCols || hasIntraFanout;

    const depthById = new Map<string, number>();
    for (const m of members) {
      depthById.set(m.id, 0);
    }

    if (useSubLevels) {
      // Relax edges up to 2 hops to form clean sub-levels (0 = callers/roots, 1 = callees, 2 = leaf helpers)
      const maxDepth = members.length > maxCols * 2 ? 2 : 1;
      for (let pass = 0; pass < maxDepth; pass++) {
        for (const m of members) {
          const d = depthById.get(m.id) ?? 0;
          for (const targetId of intraOut.get(m.id) ?? []) {
            const targetIn = intraIn.get(targetId)?.size ?? 0;
            const sourceIn = intraIn.get(m.id)?.size ?? 0;
            // Only push target down if source is more "root-like" than target (avoids 2-cycle oscillation)
            if (sourceIn <= targetIn) {
              const nextD = Math.min(maxDepth, d + 1);
              if (nextD > (depthById.get(targetId) ?? 0)) {
                depthById.set(targetId, nextD);
              }
            }
          }
        }
      }
    }

    const byDepth = new Map<number, GraphNodeDto[]>();
    for (const m of members) {
      const d = depthById.get(m.id) ?? 0;
      const list = byDepth.get(d) ?? [];
      list.push(m);
      byDepth.set(d, list);
    }

    const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b);
    const rowsForLayer: GraphNodeDto[][] = [];

    for (const d of sortedDepths) {
      const subMembers = byDepth.get(d)!;
      const numRows = Math.max(1, Math.ceil(subMembers.length / maxCols));
      const perRow = Math.ceil(subMembers.length / numRows);
      widestRowCols = Math.max(widestRowCols, Math.min(subMembers.length, perRow));
      // Placeholder: actual horizontal ordering within subMembers happens in pass 2 once upper positions are known
      rowsForLayer.push(subMembers);
    }

    layerRowsMap.set(tier, rowsForLayer);
  }

  const innerWidth = Math.max(2, widestRowCols) * COL_WIDTH - (COL_WIDTH - NODE_WIDTH);
  const laneWidth = innerWidth + LANE_PADDING_X * 2;

  const positions = new Map<string, { x: number; y: number }>();
  const rows = new Map<string, number>();
  const lanes: LaneRect[] = [];

  let cursorY = 0;
  let globalRowIdx = 0;

  // Second pass: order each sub-level using barycenter of already-placed upper neighbors, then split into balanced centered rows
  for (let tierIdx = 0; tierIdx < orderedTiers.length; tierIdx++) {
    const tier = orderedTiers[tierIdx];
    const members = groups.get(tier)!;
    const memberIds = new Set(members.map((m) => m.id));
    const subLevels = layerRowsMap.get(tier)!;

    // Intra-layer degree for tie-breaking (callers before callees)
    const intraNetScore = new Map<string, number>();
    for (const m of members) {
      let outCount = 0;
      let inCount = 0;
      for (const t of outgoingByNode.get(m.id) ?? []) {
        if (memberIds.has(t)) outCount++;
      }
      for (const s of incomingByNode.get(m.id) ?? []) {
        if (memberIds.has(s)) inCount++;
      }
      intraNetScore.set(m.id, outCount - inCount);
    }

    const finalRows: GraphNodeDto[][] = [];

    for (const subMembers of subLevels) {
      // Calculate barycenter X for nodes connected to already-positioned upper nodes
      const barycenterX = new Map<string, number>();
      for (const m of subMembers) {
        const connectedXs: number[] = [];
        for (const p of incomingByNode.get(m.id) ?? []) {
          const pos = positions.get(p);
          if (pos) connectedXs.push(pos.x);
        }
        for (const c of outgoingByNode.get(m.id) ?? []) {
          const pos = positions.get(c);
          if (pos) connectedXs.push(pos.x);
        }
        if (connectedXs.length > 0) {
          const avg = connectedXs.reduce((sum, v) => sum + v, 0) / connectedXs.length;
          barycenterX.set(m.id, avg);
        }
      }

      const withAnchor = subMembers.filter((m) => barycenterX.has(m.id));
      const withoutAnchor = subMembers.filter((m) => !barycenterX.has(m.id));

      withAnchor.sort((a, b) => {
        const diff = barycenterX.get(a.id)! - barycenterX.get(b.id)!;
        if (Math.abs(diff) > 8) return diff;
        const intraDiff = (intraNetScore.get(b.id) ?? 0) - (intraNetScore.get(a.id) ?? 0);
        if (intraDiff !== 0) return intraDiff;
        return a.path.localeCompare(b.path);
      });

      withoutAnchor.sort((a, b) => {
        const intraDiff = (intraNetScore.get(b.id) ?? 0) - (intraNetScore.get(a.id) ?? 0);
        if (intraDiff !== 0) return intraDiff;
        const degA = a.incomingCount + a.outgoingCount;
        const degB = b.incomingCount + b.outgoingCount;
        if (degB !== degA) return degB - degA;
        return a.path.localeCompare(b.path);
      });

      const centeredUnanchored = centerOutOrder(withoutAnchor);
      const orderedSub = [...withAnchor, ...centeredUnanchored];

      // Ensure any direct intra-row caller -> callee pair is ordered left-to-right
      for (let i = 0; i < orderedSub.length - 1; i++) {
        const left = orderedSub[i];
        const right = orderedSub[i + 1];
        if (
          outgoingByNode.get(right.id)?.has(left.id) &&
          !outgoingByNode.get(left.id)?.has(right.id)
        ) {
          orderedSub[i] = right;
          orderedSub[i + 1] = left;
        }
      }

      // Split into balanced rows of at most maxCols
      const numRows = Math.max(1, Math.ceil(orderedSub.length / maxCols));
      const perRow = Math.ceil(orderedSub.length / numRows);
      for (let start = 0; start < orderedSub.length; start += perRow) {
        finalRows.push(orderedSub.slice(start, start + perRow));
      }
    }

    const totalRowsInLane = Math.max(1, finalRows.length);
    const laneHeight =
      LANE_HEADER + totalRowsInLane * ROW_HEIGHT - (ROW_HEIGHT - 144) + LANE_PADDING_BOTTOM;

    finalRows.forEach((rowNodes, localRowIdx) => {
      const rowWidth = rowNodes.length * COL_WIDTH - (COL_WIDTH - NODE_WIDTH);
      const rowOffsetX = LANE_PADDING_X + (innerWidth - rowWidth) / 2;
      const rowY = cursorY + LANE_HEADER + localRowIdx * ROW_HEIGHT;

      rowNodes.forEach((n, colIdx) => {
        positions.set(n.id, {
          x: rowOffsetX + colIdx * COL_WIDTH,
          y: rowY,
        });
        rows.set(n.id, globalRowIdx);
      });
      globalRowIdx++;
    });

    // Collect distinct role labels present in this layer
    const roleCountsInLane = new Map<string, number>();
    for (const m of members) {
      const r = resolvedRoleById.get(m.id) ?? m.architecturalRole;
      const label = getRoleMeta(r).label;
      roleCountsInLane.set(label, (roleCountsInLane.get(label) ?? 0) + 1);
    }
    const roleBadges = [...roleCountsInLane.entries()].map(([label, cnt]) =>
      roleCountsInLane.size > 1 ? `${label} (${cnt})` : label
    );

    const meta = getLayerMeta(tier);
    lanes.push({
      id: `lane-${tier}`,
      step: tierIdx + 1,
      title: meta.title,
      subtitle: meta.subtitle,
      color: meta.color,
      count: members.length,
      roleBadges,
      x: 0,
      y: cursorY,
      width: laneWidth,
      height: laneHeight,
    });

    cursorY += laneHeight + LANE_GAP;
  }

  return { positions, rows, lanes };
}

/**
 * Picks which handle side of the source and target cards an architecture edge attaches to:
 * - Downward flow between rows: bottom -> top
 * - Same-row peer dependencies: right -> left (or left -> right)
 * - Upward references: top -> bottom
 */
export function archEdgeSides(
  source: { x: number; y: number },
  target: { x: number; y: number },
  sourceRow: number,
  targetRow: number
): { sourceSide: ArchSide; targetSide: ArchSide } {
  if (sourceRow !== targetRow) {
    return targetRow > sourceRow
      ? { sourceSide: 'bottom', targetSide: 'top' }
      : { sourceSide: 'top', targetSide: 'bottom' };
  }
  return target.x >= source.x
    ? { sourceSide: 'right', targetSide: 'left' }
    : { sourceSide: 'left', targetSide: 'right' };
}
