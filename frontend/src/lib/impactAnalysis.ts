import type { ArchitectureGraph, GraphNodeDto } from '../types/api';
import { getLayerMeta, getRoleMeta } from './archMeta';

export interface ImpactNode {
  path: string;
  label: string;
  role: string;
  roleLabel: string;
  layerTitle: string;
  hops: number;
  /** The intermediate file through which the dependency/impact flows. */
  viaPath?: string;
}

export interface ImpactReport {
  targetPath: string;
  /** Files that directly or transitively depend on `targetPath` (what could break if `targetPath` changes). */
  downstream: ImpactNode[];
  /** Files that `targetPath` directly or transitively depends on. */
  upstream: ImpactNode[];
  /** Map from filePath -> hop distance for downstream dependents (1 = direct, 2+ = transitive). */
  downstreamHops: Map<string, number>;
  /** Map from filePath -> hop distance for upstream dependencies (1 = direct, 2+ = transitive). */
  upstreamHops: Map<string, number>;
  /** Distinct architectural layers affected downstream. */
  affectedLayers: string[];
  /** Percentage (0-100) of total repository files affected downstream. */
  blastRadiusPercent: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Computes full multi-hop (transitive) impact analysis for a selected file.
 *
 * In `ArchitectureGraph`, an edge `source -> target` means `source` uses/depends on `target`.
 * Therefore:
 * - Downstream impact (blast radius when `targetPath` changes) walks edges in REVERSE (`target <- source`).
 * - Upstream dependencies (what `targetPath` needs) walks edges FORWARD (`source -> target`).
 */
export function computeImpactReport(
  graph: ArchitectureGraph | null,
  targetPath: string | null
): ImpactReport | null {
  if (!graph || !targetPath) return null;

  const nodeByPath = new Map<string, GraphNodeDto>();
  for (const n of graph.nodes) {
    nodeByPath.set(n.path, n);
  }
  if (!nodeByPath.has(targetPath)) return null;

  const reverseAdj = new Map<string, string[]>();
  const forwardAdj = new Map<string, string[]>();

  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    const rev = reverseAdj.get(e.target) ?? [];
    if (!rev.includes(e.source)) rev.push(e.source);
    reverseAdj.set(e.target, rev);

    const fwd = forwardAdj.get(e.source) ?? [];
    if (!fwd.includes(e.target)) fwd.push(e.target);
    forwardAdj.set(e.source, fwd);
  }

  const walk = (
    adj: Map<string, string[]>
  ): { list: ImpactNode[]; hopsMap: Map<string, number> } => {
    const hopsMap = new Map<string, number>();
    const viaMap = new Map<string, string>();
    const queue: string[] = [targetPath];
    hopsMap.set(targetPath, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentHops = hopsMap.get(current)!;
      const neighbors = adj.get(current) ?? [];
      for (const next of neighbors) {
        if (!hopsMap.has(next)) {
          hopsMap.set(next, currentHops + 1);
          if (current !== targetPath) {
            viaMap.set(next, current);
          }
          queue.push(next);
        }
      }
    }

    hopsMap.delete(targetPath);

    const list: ImpactNode[] = [];
    for (const [path, hops] of hopsMap.entries()) {
      const node = nodeByPath.get(path);
      if (!node) continue;
      const roleMeta = getRoleMeta(node.architecturalRole);
      const layerMeta = getLayerMeta(node.tier);
      list.push({
        path,
        label: node.label,
        role: node.architecturalRole,
        roleLabel: roleMeta.label,
        layerTitle: layerMeta.title,
        hops,
        viaPath: viaMap.get(path),
      });
    }

    list.sort((a, b) => a.hops - b.hops || a.path.localeCompare(b.path));
    return { list, hopsMap };
  };

  const down = walk(reverseAdj);
  const up = walk(forwardAdj);

  const affectedLayersSet = new Set<string>();
  for (const item of down.list) {
    affectedLayersSet.add(item.layerTitle);
  }

  const otherFilesCount = Math.max(1, graph.nodes.length - 1);
  const blastRadiusPercent = Math.round((down.list.length / otherFilesCount) * 100);

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (down.list.length >= 4 || blastRadiusPercent >= 45 || affectedLayersSet.size >= 3) {
    riskLevel = 'HIGH';
  } else if (down.list.length >= 2 || blastRadiusPercent >= 20 || affectedLayersSet.size >= 2) {
    riskLevel = 'MEDIUM';
  }

  return {
    targetPath,
    downstream: down.list,
    upstream: up.list,
    downstreamHops: down.hopsMap,
    upstreamHops: up.hopsMap,
    affectedLayers: [...affectedLayersSet],
    blastRadiusPercent,
    riskLevel,
  };
}
