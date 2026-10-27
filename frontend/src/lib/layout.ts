import type { GraphNodeDto } from '../types/api';
import { getLayerMeta, layerOrder } from './archMeta';

export const NODE_WIDTH = 232;
export const COL_WIDTH = 262;
export const ROW_HEIGHT = 168;
const LANE_PADDING = 24;
const LANE_HEADER = 58;
const LANE_GAP = 36;
const MAX_PER_ROW = 3;

export interface LaneRect {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  positions: Map<string, { x: number; y: number }>;
  lanes: LaneRect[];
}

/**
 * Lays the architecture out as horizontal "layers" stacked top to bottom,
 * from what users see (frontend) down to the data (models).
 */
export function layoutGraph(nodes: GraphNodeDto[]): GraphLayout {
  const groups = new Map<string, GraphNodeDto[]>();
  for (const n of nodes) {
    const list = groups.get(n.tier) ?? [];
    list.push(n);
    groups.set(n.tier, list);
  }

  const orderedTiers = [...groups.keys()].sort(
    (a, b) => layerOrder(a) - layerOrder(b) || a.localeCompare(b)
  );

  const widestBand = Math.max(
    1,
    ...orderedTiers.map((t) => Math.min(groups.get(t)!.length, MAX_PER_ROW))
  );
  const innerWidth = widestBand * COL_WIDTH - (COL_WIDTH - NODE_WIDTH);

  const positions = new Map<string, { x: number; y: number }>();
  const lanes: LaneRect[] = [];
  let cursorY = 0;

  for (const tier of orderedTiers) {
    const members = [...groups.get(tier)!].sort((a, b) => a.path.localeCompare(b.path));
    const rows = Math.ceil(members.length / MAX_PER_ROW);
    const bandCols = Math.min(members.length, MAX_PER_ROW);
    const bandWidth = bandCols * COL_WIDTH - (COL_WIDTH - NODE_WIDTH);
    const offsetX = LANE_PADDING + (innerWidth - bandWidth) / 2;
    const height = LANE_HEADER + rows * ROW_HEIGHT + 8;

    members.forEach((n, i) => {
      positions.set(n.id, {
        x: offsetX + (i % MAX_PER_ROW) * COL_WIDTH,
        y: cursorY + LANE_HEADER + Math.floor(i / MAX_PER_ROW) * ROW_HEIGHT,
      });
    });

    const meta = getLayerMeta(tier);
    lanes.push({
      id: `lane-${tier}`,
      title: meta.title,
      subtitle: meta.subtitle,
      color: meta.color,
      count: members.length,
      x: 0,
      y: cursorY,
      width: innerWidth + LANE_PADDING * 2,
      height,
    });

    cursorY += height + LANE_GAP;
  }

  return { positions, lanes };
}
