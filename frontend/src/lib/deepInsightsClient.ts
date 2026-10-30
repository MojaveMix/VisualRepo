import type {
  ArchitectureGraph,
  DependencyCycleDto,
  ErDiagram,
  ErEntity,
  FileInsightDto,
  GraphEdgeDto,
  GraphNodeDto,
  InferredErRelationDto,
  LayerViolationDto,
  ModuleClusterDto,
  ProjectInsights,
} from '../types/api';
import { describeFile, refineArchitecturalRole, roleToLayerKey } from './archMeta';

export const CLUSTER_PALETTE = [
  '#6366f1', // Indigo
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#a855f7', // Purple
  '#3b82f6', // Blue
  '#f43f5e', // Rose
  '#14b8a6', // Teal
  '#84cc16', // Lime
];

export function getClusterColor(clusterId: number): string {
  if (!clusterId || clusterId <= 0) return '#64748b';
  return CLUSTER_PALETTE[(clusterId - 1) % CLUSTER_PALETTE.length];
}

const LAYER_RANK: Record<string, number> = {
  UI_COMPONENT: 0,
  API_CLIENT: 1,
  CONTROLLER: 2,
  SERVICE: 3,
  REPOSITORY: 4,
  MODEL: 5,
};

const STOP_STEMS = new Set([
  'src',
  'main',
  'test',
  'tests',
  'java',
  'kotlin',
  'python',
  'com',
  'org',
  'net',
  'io',
  'app',
  'lib',
  'core',
  'common',
  'shared',
  'utils',
  'util',
  'frontend',
  'backend',
  'client',
  'server',
  'web',
  'ui',
  'api',
  'controller',
  'controllers',
  'service',
  'services',
  'repository',
  'repositories',
  'model',
  'models',
  'entity',
  'entities',
  'dto',
  'dtos',
  'config',
  'components',
  'pages',
  'views',
  'routes',
  'types',
  'schema',
  'db',
]);

function singularize(word: string): string {
  if (!word || word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('sses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    return word.slice(0, -1);
  }
  return word;
}

function normalizeStem(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function extractDomainStem(path: string, role: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const fileBase = (parts[parts.length - 1] || '').replace(/\.[^.]+$/, '');
  const stripped = fileBase
    .replace(
      /(Controller|ServiceImpl|Service|JpaRepository|Repository|Entity|Model|Dto|Dtos|Request|Response|Client|Api|View|Page|Panel|Card|Node|Dialog|Form|Test|Tests|Config)$/i,
      ''
    )
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();

  for (const tok of stripped.split(/[_\-.]+/)) {
    if (tok.length >= 3 && !STOP_STEMS.has(tok)) {
      return singularize(tok);
    }
  }
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i].toLowerCase();
    if (seg.length >= 3 && !STOP_STEMS.has(seg)) {
      return singularize(seg);
    }
  }
  if (role === 'UI_COMPONENT' || role === 'API_CLIENT') return 'frontend-ui';
  if (role === 'CONFIG' || role === 'TEST') return 'platform-config';
  return 'core-domain';
}

function humanizeCluster(stem: string): string {
  const words = stem
    .split(/[_\-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? `${words.join(' ')} Module` : 'Core Module';
}

/**
 * Deterministic client-side deep analysis fallback so the UI always has rich
 * PageRank importance, cycles, clusters, layer violations, and ER inferences
 * even before or without a backend round-trip.
 */
export function computeClientSideInsights(
  graph: ArchitectureGraph | null,
  erDiagram: ErDiagram | null
): ProjectInsights | null {
  if (!graph) return null;

  const nodes = graph.nodes;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const validEdges = graph.edges.filter(
    (e) => e.source !== e.target && nodeById.has(e.source) && nodeById.has(e.target)
  );

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const apiCallSources = new Set<string>();
  const apiCallTargets = new Set<string>();

  for (const n of nodes) {
    outgoing.set(n.id, new Set());
    incoming.set(n.id, new Set());
  }
  for (const e of validEdges) {
    outgoing.get(e.source)!.add(e.target);
    incoming.get(e.target)!.add(e.source);
    if (e.relationType === 'API_CALL') {
      apiCallSources.add(e.source);
      apiCallTargets.add(e.target);
    }
  }

  // 1. Role refinement with graph context
  const roleByPath = new Map<string, string>();
  const reasonsByPath = new Map<string, string[]>();
  const confidenceByPath = new Map<string, number>();

  for (const n of nodes) {
    let role = refineArchitecturalRole(n.path, n.architecturalRole, n.language);
    const reasons: string[] = [];
    let conf = 0.82;

    if (apiCallSources.has(n.id) && role !== 'UI_COMPONENT') {
      role = 'API_CLIENT';
      conf = 0.92;
      reasons.push('Dispatches cross-stack HTTP calls to backend API endpoints');
    }
    if (apiCallTargets.has(n.id)) {
      role = 'CONTROLLER';
      conf = 0.95;
      reasons.push('Receives HTTP API calls from frontend client layer');
    }
    reasons.push(`Classified as ${role} from path, naming & ${n.symbols.length} extracted symbol(s)`);

    roleByPath.set(n.id, role);
    reasonsByPath.set(n.id, reasons);
    confidenceByPath.set(n.id, conf);
  }

  // Second pass: graph neighborhood sandwich (Controller -> Service -> Repository -> Model)
  for (const n of nodes) {
    const inPeers = [...(incoming.get(n.id) ?? [])];
    const outPeers = [...(outgoing.get(n.id) ?? [])];
    const currentRole = roleByPath.get(n.id)!;

    const calledByController = inPeers.some((p) => roleByPath.get(p) === 'CONTROLLER');
    const callsRepoOrModel = outPeers.some(
      (p) => roleByPath.get(p) === 'REPOSITORY' || roleByPath.get(p) === 'MODEL'
    );
    if (calledByController && callsRepoOrModel && currentRole === 'MODULE') {
      roleByPath.set(n.id, 'SERVICE');
      confidenceByPath.set(n.id, 0.89);
      reasonsByPath.get(n.id)!.unshift('Bridges Controller requests to Repository/Model persistence');
    }
  }

  // 2. PageRank centrality
  const N = Math.max(1, nodes.length);
  const damping = 0.85;
  let rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 1 / N);

  for (let iter = 0; iter < 20; iter++) {
    const next = new Map<string, number>();
    for (const n of nodes) {
      let sum = 0;
      for (const caller of incoming.get(n.id) ?? []) {
        const outDeg = Math.max(1, outgoing.get(caller)?.size ?? 1);
        sum += (rank.get(caller) ?? 0) / outDeg;
      }
      for (const callee of outgoing.get(n.id) ?? []) {
        const inDeg = Math.max(1, incoming.get(callee)?.size ?? 1);
        sum += 0.25 * ((rank.get(callee) ?? 0) / inDeg);
      }
      next.set(n.id, (1 - damping) / N + damping * sum);
    }
    rank = next;
  }
  const maxRank = Math.max(1e-6, ...rank.values());

  // 3. Tarjan Strongly Connected Components (Cycles)
  const indexMap = new Map<string, number>();
  const lowMap = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: DependencyCycleDto[] = [];
  let idxCounter = 0;

  function strongConnect(v: string) {
    indexMap.set(v, idxCounter);
    lowMap.set(v, idxCounter);
    idxCounter++;
    stack.push(v);
    onStack.add(v);

    for (const w of outgoing.get(v) ?? []) {
      if (!indexMap.has(w)) {
        strongConnect(w);
        lowMap.set(v, Math.min(lowMap.get(v)!, lowMap.get(w)!));
      } else if (onStack.has(w)) {
        lowMap.set(v, Math.min(lowMap.get(v)!, indexMap.get(w)!));
      }
    }

    if (lowMap.get(v) === indexMap.get(v)) {
      const comp: string[] = [];
      while (stack.length > 0) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length >= 2) {
        cycles.push({ files: comp.reverse() });
      }
    }
  }

  for (const n of nodes) {
    if (!indexMap.has(n.id)) strongConnect(n.id);
  }
  const cycleSet = new Set(cycles.flatMap((c) => c.files));

  // 4. Topological depth from entry points
  const depthMap = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    const r = roleByPath.get(n.id)!;
    if ((incoming.get(n.id)?.size ?? 0) === 0 || r === 'UI_COMPONENT' || r === 'CONTROLLER') {
      depthMap.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depthMap.get(cur) ?? 0;
    if (d > nodes.length) continue;
    for (const nxt of outgoing.get(cur) ?? []) {
      if (!depthMap.has(nxt)) {
        depthMap.set(nxt, d + 1);
        queue.push(nxt);
      }
    }
  }

  // 5. Community / Module Clusters
  const stemByGroup = new Map<string, string[]>();
  for (const n of nodes) {
    const stem = extractDomainStem(n.path, roleByPath.get(n.id)!);
    const list = stemByGroup.get(stem) ?? [];
    list.push(n.id);
    stemByGroup.set(stem, list);
  }

  const sortedStems = [...stemByGroup.entries()].sort((a, b) => b[1].length - a[1].length);
  const clusters: ModuleClusterDto[] = [];
  const clusterByPath = new Map<string, number>();

  sortedStems.forEach(([stem, memberPaths], i) => {
    const id = i + 1;
    const memberSet = new Set(memberPaths);
    let internal = 0;
    let boundary = 0;
    const roleCounts = new Map<string, number>();

    for (const p of memberPaths) {
      clusterByPath.set(p, id);
      const r = roleByPath.get(p) ?? 'MODULE';
      roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
      for (const t of outgoing.get(p) ?? []) {
        if (memberSet.has(t)) internal++;
        else boundary++;
      }
      for (const s of incoming.get(p) ?? []) {
        if (!memberSet.has(s)) boundary++;
      }
    }
    const denom = internal * 2 + boundary;
    const cohesion = denom <= 0 ? 0.7 : Math.round(Math.min(1, (internal * 2) / denom) * 100) / 100;
    const dominantRole =
      [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'MODULE';

    clusters.push({
      id,
      name: humanizeCluster(stem),
      files: memberPaths,
      cohesion,
      dominantRole,
    });
  });

  // 6. Layer Violations
  const violations: LayerViolationDto[] = [];
  const hasService = [...roleByPath.values()].includes('SERVICE');
  for (const e of validEdges) {
    const sr = roleByPath.get(e.source) ?? 'MODULE';
    const tr = roleByPath.get(e.target) ?? 'MODULE';
    const sRank = LAYER_RANK[sr];
    const tRank = LAYER_RANK[tr];
    if (sRank === undefined || tRank === undefined || sr === tr) continue;

    if (sRank > tRank) {
      violations.push({
        source: e.source,
        target: e.target,
        sourceRole: sr,
        targetRole: tr,
        reason: `Upward layer inversion: ${sr} depends on higher-level ${tr}`,
      });
    } else if (sr === 'CONTROLLER' && tr === 'REPOSITORY' && hasService) {
      violations.push({
        source: e.source,
        target: e.target,
        sourceRole: sr,
        targetRole: tr,
        reason: 'Layer bypass: Controller calls Repository directly, skipping Service layer',
      });
    }
  }

  // 7. Database ER Inference
  const inferredRelations = inferClientErRelations(erDiagram);

  // 8. Build FileInsightDto list
  let reclassifiedCount = 0;
  let confSum = 0;
  const fileInsights: FileInsightDto[] = nodes.map((n) => {
    const role = roleByPath.get(n.id) ?? n.architecturalRole;
    if (role !== n.architecturalRole) reclassifiedCount++;
    const conf = confidenceByPath.get(n.id) ?? 0.82;
    confSum += conf;
    const desc = describeFile({ ...n, architecturalRole: role });

    return {
      path: n.path,
      role,
      originalRole: n.architecturalRole,
      confidence: conf,
      reasons: reasonsByPath.get(n.id) ?? [],
      summary: desc.purpose,
      clusterId: clusterByPath.get(n.id) ?? 1,
      importance: Math.round(((rank.get(n.id) ?? 0) / maxRank) * 100) / 100,
      depth: depthMap.get(n.id) ?? LAYER_RANK[role] ?? 2,
      inCycle: cycleSet.has(n.id),
      fanIn: incoming.get(n.id)?.size ?? n.incomingCount,
      fanOut: outgoing.get(n.id)?.size ?? n.outgoingCount,
    };
  });

  return {
    repositoryId: graph.repositoryId,
    engine: 'algorithm',
    modelUsed: 'graph-algorithms',
    aiAvailable: false,
    generatedAt: new Date().toISOString(),
    architectureStyle: 'Layered Architecture (UI → Controller → Service → Repository → Model)',
    overview: `${graph.repoFullName} contains ${nodes.length} indexed files and ${validEdges.length} verified dependencies across ${clusters.length} domain module clusters.`,
    files: fileInsights,
    clusters,
    cycles,
    violations,
    prunedEdges: [],
    inferredRelations,
    reclassifiedCount,
    averageConfidence: nodes.length ? Math.round((confSum / nodes.length) * 100) / 100 : 1,
    warnings: [],
  };
}

function inferClientErRelations(erDiagram: ErDiagram | null): InferredErRelationDto[] {
  if (!erDiagram || erDiagram.entities.length < 2) return [];
  const entities = erDiagram.entities;
  const existingPairs = new Set<string>();
  for (const r of erDiagram.relations) {
    existingPairs.add(`${r.source}<->${r.target}`);
    existingPairs.add(`${r.target}<->${r.source}`);
  }

  const byStem = new Map<string, ErEntity>();
  for (const e of entities) {
    const tNorm = normalizeStem(e.tableName);
    const cNorm = normalizeStem(e.className.replace(/(Entity|Model|Table|Schema)$/i, ''));
    if (tNorm) {
      byStem.set(tNorm, e);
      byStem.set(singularize(tNorm), e);
    }
    if (cNorm) {
      byStem.set(cNorm, e);
      byStem.set(singularize(cNorm), e);
    }
  }

  const inferred: InferredErRelationDto[] = [];
  let seq = 1;

  for (const src of entities) {
    for (const col of src.columns) {
      if (col.primaryKey && /^(id|uuid)$/i.test(col.name)) continue;
      const lower = col.name.toLowerCase();
      let prefix: string | null = null;
      for (const sfx of ['_id', '_fk', '_uuid', '_code']) {
        if (lower.endsWith(sfx) && lower.length > sfx.length + 1) {
          prefix = lower.slice(0, -sfx.length);
          break;
        }
      }
      if (!prefix && /[a-z0-9](Id|Fk|Uuid)$/.test(col.fieldName || col.name)) {
        prefix = (col.fieldName || col.name).replace(/(Id|Fk|Uuid)$/, '');
      }
      if (!prefix) continue;

      const norm = normalizeStem(prefix);
      const tgt = byStem.get(norm) ?? byStem.get(singularize(norm));
      if (tgt && tgt.id !== src.id) {
        const key = `${src.id}<->${tgt.id}`;
        if (!existingPairs.has(key)) {
          existingPairs.add(key);
          existingPairs.add(`${tgt.id}<->${src.id}`);
          inferred.push({
            id: `client-inferred-er-${seq++}`,
            source: src.id,
            target: tgt.id,
            type: 'MANY_TO_ONE',
            fieldName: col.fieldName || col.name,
            joinColumn: col.name,
            joinTable: null,
            confidence: 0.84,
            evidence: `Column ${src.tableName}.${col.name} matches table '${tgt.tableName}' by FK naming convention`,
            origin: 'algorithm',
          });
        }
      }
    }
  }

  return inferred;
}

export interface EnrichedGraphBundle {
  graph: ArchitectureGraph | null;
  fileInsightMap: Map<string, FileInsightDto>;
  clusterMap: Map<number, ModuleClusterDto>;
  violationEdgeKeys: Set<string>;
  violationMap: Map<string, LayerViolationDto>;
  cycleFileSet: Set<string>;
}

/**
 * Merges `ProjectInsights` into `ArchitectureGraph`:
 * - Removes false-positive `prunedEdges`
 * - Updates node roles, layer tiers, and degree counts
 * - Exposes lookup maps for PageRank, clusters, cycles, and layer violations
 */
export function applyInsightsToGraph(
  rawGraph: ArchitectureGraph | null,
  insights: ProjectInsights | null
): EnrichedGraphBundle {
  const fileInsightMap = new Map<string, FileInsightDto>();
  const clusterMap = new Map<number, ModuleClusterDto>();
  const violationEdgeKeys = new Set<string>();
  const violationMap = new Map<string, LayerViolationDto>();
  const cycleFileSet = new Set<string>();

  if (insights) {
    for (const f of insights.files) {
      fileInsightMap.set(f.path, f);
      if (f.inCycle) cycleFileSet.add(f.path);
    }
    for (const c of insights.clusters) {
      clusterMap.set(c.id, c);
    }
    for (const v of insights.violations) {
      const k = `${v.source}->${v.target}`;
      violationEdgeKeys.add(k);
      violationMap.set(k, v);
    }
  }

  if (!rawGraph) {
    return {
      graph: null,
      fileInsightMap,
      clusterMap,
      violationEdgeKeys,
      violationMap,
      cycleFileSet,
    };
  }

  if (!insights) {
    return {
      graph: rawGraph,
      fileInsightMap,
      clusterMap,
      violationEdgeKeys,
      violationMap,
      cycleFileSet,
    };
  }

  const prunedSet = new Set(insights.prunedEdges.map((p) => `${p.source}->${p.target}`));
  const cleanEdges: GraphEdgeDto[] = rawGraph.edges.filter(
    (e) => !prunedSet.has(`${e.source}->${e.target}`)
  );

  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  for (const e of cleanEdges) {
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
  }

  const roleCounts: Record<string, number> = {};
  const enrichedNodes: GraphNodeDto[] = rawGraph.nodes.map((n) => {
    const fi = fileInsightMap.get(n.path);
    const effectiveRole = fi?.role ?? refineArchitecturalRole(n.path, n.architecturalRole, n.language);
    roleCounts[effectiveRole] = (roleCounts[effectiveRole] ?? 0) + 1;
    return {
      ...n,
      architecturalRole: effectiveRole,
      tier: roleToLayerKey(effectiveRole),
      incomingCount: inCount.get(n.id) ?? fi?.fanIn ?? n.incomingCount,
      outgoingCount: outCount.get(n.id) ?? fi?.fanOut ?? n.outgoingCount,
    };
  });

  return {
    graph: {
      ...rawGraph,
      nodes: enrichedNodes,
      edges: cleanEdges,
      roleCounts,
    },
    fileInsightMap,
    clusterMap,
    violationEdgeKeys,
    violationMap,
    cycleFileSet,
  };
}

export interface EnrichedErBundle {
  diagram: ErDiagram | null;
  inferredById: Map<string, InferredErRelationDto>;
}

/**
 * Merges `inferredRelations` from `ProjectInsights` into `ErDiagram` so both React Flow
 * and the 3D Relational Explorer render discovered foreign-key and join relationships.
 */
export function applyInsightsToErDiagram(
  rawEr: ErDiagram | null,
  insights: ProjectInsights | null,
  includeInferred = true
): EnrichedErBundle {
  const inferredById = new Map<string, InferredErRelationDto>();
  if (!rawEr) return { diagram: null, inferredById };
  if (!insights || !includeInferred || insights.inferredRelations.length === 0) {
    return { diagram: rawEr, inferredById };
  }

  const entityIds = new Set(rawEr.entities.map((e) => e.id));
  const entityById = new Map(rawEr.entities.map((e) => [e.id, e]));
  const existingPairs = new Set<string>();
  for (const r of rawEr.relations) {
    existingPairs.add(`${r.source}<->${r.target}`);
    existingPairs.add(`${r.target}<->${r.source}`);
  }

  const mergedRelations = [...rawEr.relations];
  const fkMarkByEntityCol = new Map<string, string>();

  for (const inf of insights.inferredRelations) {
    if (!entityIds.has(inf.source) || !entityIds.has(inf.target) || inf.source === inf.target) {
      continue;
    }
    const pairKey = `${inf.source}<->${inf.target}`;
    if (existingPairs.has(pairKey)) continue;
    existingPairs.add(pairKey);
    existingPairs.add(`${inf.target}<->${inf.source}`);

    inferredById.set(inf.id, inf);
    mergedRelations.push({
      id: inf.id,
      source: inf.source,
      target: inf.target,
      type: inf.type,
      fieldName: inf.fieldName,
      joinColumn: inf.joinColumn,
      joinTable: inf.joinTable,
    });

    if (inf.joinColumn) {
      const targetTable = entityById.get(inf.target)?.tableName ?? inf.target;
      fkMarkByEntityCol.set(`${inf.source}:${inf.joinColumn.toLowerCase()}`, targetTable);
    }
  }

  const enrichedEntities = rawEr.entities.map((entity) => {
    let changed = false;
    const cols = entity.columns.map((c) => {
      const refTarget = fkMarkByEntityCol.get(`${entity.id}:${c.name.toLowerCase()}`);
      if (refTarget && !c.foreignKey) {
        changed = true;
        return {
          ...c,
          foreignKey: true,
          references: c.references || refTarget,
        };
      }
      return c;
    });
    return changed ? { ...entity, columns: cols } : entity;
  });

  return {
    diagram: {
      ...rawEr,
      entities: enrichedEntities,
      relations: mergedRelations,
    },
    inferredById,
  };
}
