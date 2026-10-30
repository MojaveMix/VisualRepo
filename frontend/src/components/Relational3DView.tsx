import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Box,
  Compass,
  Database,
  Eye,
  EyeOff,
  Layers,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  StepBack,
  StepForward,
  Zap,
} from 'lucide-react';
import type {
  ArchitectureGraph,
  ErDiagram,
  ErEntity,
  FileInsightDto,
  GraphNodeDto,
  InferredErRelationDto,
  LayerViolationDto,
  ModuleClusterDto,
} from '../types/api';
import { getRoleMeta, LAYERS, refineArchitecturalRole, resolveNodeLayerKey } from '../lib/archMeta';
import { CARDINALITY } from '../lib/erLayout';
import { getClusterColor } from '../lib/deepInsightsClient';
import type { ImpactReport } from '../lib/impactAnalysis';
import { useTheme } from '../lib/theme';

export type Scene3DMode = 'tower' | 'constellation' | 'er3d';
export type Color3DMode = 'layer' | 'cluster' | 'importance';

interface Relational3DViewProps {
  graphData: ArchitectureGraph | null;
  erDiagram: ErDiagram | null;
  fileInsightMap: Map<string, FileInsightDto>;
  clusterMap: Map<number, ModuleClusterDto>;
  violationEdgeKeys: Set<string>;
  violationMap: Map<string, LayerViolationDto>;
  inferredErMap: Map<string, InferredErRelationDto>;
  citedFileMap: Map<string, string>;
  impactReport: ImpactReport | null;
  impactMode: boolean;
  selectedFilePath: string | null;
  selectedEntityId: string | null;
  activeClusterId: number | null;
  query: string;
  roleFilter: string;
  onSelectFile: (filePath: string) => void;
  onSelectEntity: (entity: ErEntity) => void;
}

interface Node3DItem {
  id: string;
  kind: 'file' | 'table';
  label: string;
  sublabel: string;
  role: string;
  layerKey: string;
  color: string;
  clusterColor: string;
  clusterId: number;
  clusterName: string;
  importance: number;
  confidence: number;
  inCycle: boolean;
  isCited: boolean;
  citationLines?: string;
  lineCount: number;
  fanIn: number;
  fanOut: number;
  summary: string;
  reasons: string[];
  symbols: string[];
  position: THREE.Vector3;
  radius: number;
  fileNode?: GraphNodeDto;
  erEntity?: ErEntity;
}

interface Edge3DItem {
  id: string;
  source: string;
  target: string;
  kind: 'import' | 'injection' | 'api_call' | 'er_fk' | 'er_inferred' | 'orm_map' | 'violation';
  label: string;
  color: string;
  isHighlighted: boolean;
  isDimmed: boolean;
}

interface WalkthroughStep {
  stepNumber: number;
  nodeId: string;
  kind: 'file' | 'table';
  stageTitle: string;
  headline: string;
  explanation: string;
  badgeColor: string;
}

const ROLE_HEX: Record<string, string> = {
  UI_COMPONENT: '#ec4899',
  API_CLIENT: '#a855f7',
  CONTROLLER: '#f59e0b',
  SERVICE: '#6366f1',
  REPOSITORY: '#10b981',
  MODEL: '#06b6d4',
  MODULE: '#3b82f6',
  CONFIG: '#64748b',
  TEST: '#64748b',
  DB_TABLE: '#22d3ee',
};

function createTextSprite(
  title: string,
  subtitle: string,
  accentHex: string,
  isSelected: boolean,
  isDark: boolean,
  badgeText?: string
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const width = 512;
  const height = 144;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, width, height);

  // Pill background
  const padX = 16;
  const padY = 14;
  const boxW = width - padX * 2;
  const boxH = height - padY * 2;
  const radius = 24;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(padX, padY, boxW, boxH, radius);
  ctx.fillStyle = isDark
    ? isSelected
      ? 'rgba(30, 27, 75, 0.94)'
      : 'rgba(15, 23, 42, 0.88)'
    : isSelected
    ? 'rgba(238, 242, 255, 0.96)'
    : 'rgba(255, 255, 255, 0.92)';
  ctx.fill();

  ctx.lineWidth = isSelected ? 4 : 2.2;
  ctx.strokeStyle = isSelected ? '#818cf8' : accentHex;
  ctx.stroke();

  // Left color bar
  ctx.beginPath();
  ctx.roundRect(padX + 8, padY + 14, 8, boxH - 28, 4);
  ctx.fillStyle = accentHex;
  ctx.fill();

  // Title text
  ctx.font = 'bold 28px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
  const maxTitleChars = badgeText ? 21 : 27;
  const cleanTitle = title.length > maxTitleChars ? title.slice(0, maxTitleChars - 1) + '…' : title;
  ctx.fillText(cleanTitle, padX + 28, padY + 48);

  // Subtitle text
  ctx.font = '600 20px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
  const cleanSub = subtitle.length > 34 ? subtitle.slice(0, 33) + '…' : subtitle;
  ctx.fillText(cleanSub, padX + 28, padY + 84);

  // Optional right badge
  if (badgeText) {
    ctx.font = 'bold 18px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(badgeText).width;
    const bw = tw + 22;
    const bx = padX + boxW - bw - 14;
    const by = padY + 22;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 32, 12);
    ctx.fillStyle = accentHex + '33';
    ctx.fill();
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a';
    ctx.fillText(badgeText, bx + 11, by + 22);
  }

  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(16.5, 4.6, 1);
  return sprite;
}

function createPlatformLabelSprite(title: string, countText: string, colorHex: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 80, 18);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = colorHex;
  ctx.stroke();

  ctx.font = 'bold 26px Inter, system-ui, sans-serif';
  ctx.fillStyle = colorHex;
  ctx.fillText(title.slice(0, 26), 26, 46);

  ctx.font = '600 19px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(countText, 26, 74);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(22, 4.1, 1);
  return sprite;
}

export function Relational3DView({
  graphData,
  erDiagram,
  fileInsightMap,
  clusterMap,
  violationEdgeKeys,
  violationMap,
  inferredErMap,
  citedFileMap,
  impactReport,
  impactMode,
  selectedFilePath,
  selectedEntityId,
  activeClusterId,
  query,
  roleFilter,
  onSelectFile,
  onSelectEntity,
}: Relational3DViewProps) {
  const { isDark } = useTheme();
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [sceneMode, setSceneMode] = useState<Scene3DMode>('tower');
  const [colorMode, setColorMode] = useState<Color3DMode>('layer');
  const [showLabels, setShowLabels] = useState(true);
  const [showParticles, setShowParticles] = useState(true);
  const [showPlatforms, setShowPlatforms] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<Node3DItem | null>(null);
  const [walkthroughIndex, setWalkthroughIndex] = useState<number | null>(null);
  const [walkthroughPlaying, setWalkthroughPlaying] = useState(false);

  // Camera spherical state ref for smooth damping without React re-renders on every frame
  const cameraStateRef = useRef({
    theta: 0.55,
    phi: 1.12,
    radius: 135,
    target: new THREE.Vector3(0, 0, 0),
    desiredTarget: new THREE.Vector3(0, 0, 0),
    desiredRadius: 135,
    isDragging: false,
    dragMode: 'orbit' as 'orbit' | 'pan',
    prevX: 0,
    prevY: 0,
    pointerDownX: 0,
    pointerDownY: 0,
  });

  // Build unified 3D relational graph (Code Files + Database ER Tables + Links)
  const { items, edges, platforms, walkthroughSteps } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visibleFiles = (graphData?.nodes ?? [])
      .filter((n) => {
        if (sceneMode === 'er3d') return false;
        const fi = fileInsightMap.get(n.path);
        const effRole = fi?.role ?? refineArchitecturalRole(n.path, n.architecturalRole, n.language);
        if (roleFilter !== 'ALL' && effRole !== roleFilter) return false;
        if (activeClusterId !== null && fi && fi.clusterId !== activeClusterId) return false;
        if (
          q &&
          !n.path.toLowerCase().includes(q) &&
          !n.symbols.some((s) => s.toLowerCase().includes(q))
        ) {
          return false;
        }
        return true;
      });

    const visibleEntities = (erDiagram?.entities ?? []).filter((e) => {
      if (sceneMode === 'constellation' && roleFilter !== 'ALL' && roleFilter !== 'MODEL') {
        return false;
      }
      if (
        q &&
        !e.tableName.toLowerCase().includes(q) &&
        !e.className.toLowerCase().includes(q) &&
        !e.columns.some((c) => c.name.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });

    const nodeItems: Node3DItem[] = [];
    const itemById = new Map<string, Node3DItem>();

    // Group files by layer for 'tower' mode
    const filesByLayer = new Map<string, GraphNodeDto[]>();
    for (const f of visibleFiles) {
      const fi = fileInsightMap.get(f.path);
      const role = fi?.role ?? refineArchitecturalRole(f.path, f.architecturalRole, f.language);
      const layerKey = resolveNodeLayerKey({ ...f, architecturalRole: role });
      const list = filesByLayer.get(layerKey) ?? [];
      list.push(f);
      filesByLayer.set(layerKey, list);
    }

    const activeLayers = LAYERS.filter((l) => (filesByLayer.get(l.key)?.length ?? 0) > 0);
    const totalLevels = activeLayers.length + (visibleEntities.length > 0 ? 1 : 0);
    const levelGapY = 22;
    const topY = ((totalLevels - 1) * levelGapY) / 2;

    const platformList: {
      id: string;
      title: string;
      subtitle: string;
      y: number;
      radius: number;
      color: string;
      countLabel: string;
    }[] = [];

    // Position file nodes
    activeLayers.forEach((layerMeta, layerIdx) => {
      const y = topY - layerIdx * levelGapY;
      const members = filesByLayer.get(layerMeta.key) ?? [];
      // Sort by cluster then importance so related files sit next to each other on the ring
      members.sort((a, b) => {
        const ca = fileInsightMap.get(a.path)?.clusterId ?? 0;
        const cb = fileInsightMap.get(b.path)?.clusterId ?? 0;
        if (ca !== cb) return ca - cb;
        const ia = fileInsightMap.get(a.path)?.importance ?? 0;
        const ib = fileInsightMap.get(b.path)?.importance ?? 0;
        return ib - ia;
      });

      const count = members.length;
      const ringRadius = count === 1 ? 0 : Math.max(14, Math.min(44, 9 + count * 3.1));

      platformList.push({
        id: `platform-${layerMeta.key}`,
        title: `${layerIdx + 1}. ${layerMeta.title}`,
        subtitle: layerMeta.subtitle,
        y: y - 2.2,
        radius: Math.max(22, ringRadius + 9),
        color: layerMeta.color,
        countLabel: `${count} ${count === 1 ? 'file' : 'files'}`,
      });

      members.forEach((f, idx) => {
        const fi = fileInsightMap.get(f.path);
        const role = fi?.role ?? refineArchitecturalRole(f.path, f.architecturalRole, f.language);
        const clusterId = fi?.clusterId ?? 1;
        const cluster = clusterMap.get(clusterId);
        const importance = fi?.importance ?? 0.45;
        const confidence = fi?.confidence ?? 0.85;

        let pos: THREE.Vector3;
        if (sceneMode === 'constellation') {
          // 3D Cluster Galaxy positioning: each cluster has a 3D center on a Fibonacci sphere
          const totalClusters = Math.max(1, clusterMap.size);
          const goldenAngle = Math.PI * (3 - Math.sqrt(5));
          const cIdx = Math.max(0, clusterId - 1);
          const cY = totalClusters === 1 ? 0 : 1 - (cIdx / Math.max(1, totalClusters - 1)) * 2;
          const cRad = Math.sqrt(Math.max(0, 1 - cY * cY));
          const cTheta = goldenAngle * cIdx;
          const galaxyDist = totalClusters <= 1 ? 0 : 28;
          const centerX = Math.cos(cTheta) * cRad * galaxyDist;
          const centerY = cY * 22;
          const centerZ = Math.sin(cTheta) * cRad * galaxyDist;

          const localAngle = (idx / Math.max(1, count)) * Math.PI * 2 + idx * 0.6;
          const localR = 7 + (idx % 4) * 4.2;
          const localY = ((idx % 3) - 1) * 4.5;
          pos = new THREE.Vector3(
            centerX + Math.cos(localAngle) * localR,
            centerY + localY,
            centerZ + Math.sin(localAngle) * localR
          );
        } else {
          // Tower mode: concentric rings on the layer's Y platform
          if (count === 1) {
            pos = new THREE.Vector3(0, y, 0);
          } else {
            const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
            const radialJitter = count > 10 && idx % 2 === 1 ? ringRadius * 0.68 : ringRadius;
            pos = new THREE.Vector3(
              Math.cos(angle) * radialJitter,
              y,
              Math.sin(angle) * radialJitter
            );
          }
        }

        const nodeSize = 1.65 + importance * 1.35 + Math.min(0.8, Math.log10(Math.max(10, f.lineCount)) * 0.25);
        const roleMeta = getRoleMeta(role);
        const item: Node3DItem = {
          id: f.id,
          kind: 'file',
          label: f.label,
          sublabel: `${roleMeta.label} · ${f.lineCount}L`,
          role,
          layerKey: layerMeta.key,
          color: ROLE_HEX[role] ?? layerMeta.color,
          clusterColor: getClusterColor(clusterId),
          clusterId,
          clusterName: cluster?.name ?? 'Core Module',
          importance,
          confidence,
          inCycle: fi?.inCycle ?? false,
          isCited: citedFileMap.has(f.path),
          citationLines: citedFileMap.get(f.path),
          lineCount: f.lineCount,
          fanIn: fi?.fanIn ?? f.incomingCount,
          fanOut: fi?.fanOut ?? f.outgoingCount,
          summary: fi?.summary || `${roleMeta.label} in ${f.directory}`,
          reasons: fi?.reasons ?? [],
          symbols: f.symbols ?? [],
          position: pos,
          radius: nodeSize,
          fileNode: f,
        };
        nodeItems.push(item);
        itemById.set(item.id, item);
      });
    });

    // Position Database ER Tables
    if (visibleEntities.length > 0) {
      const dbY = sceneMode === 'er3d' ? 0 : topY - activeLayers.length * levelGapY - 4;
      const tCount = visibleEntities.length;
      const dbRingRadius =
        tCount === 1 ? 0 : sceneMode === 'er3d' ? Math.max(18, Math.min(48, 12 + tCount * 4.5)) : Math.max(15, Math.min(40, 10 + tCount * 3.6));

      if (sceneMode !== 'constellation') {
        platformList.push({
          id: 'platform-database-er',
          title:
            sceneMode === 'er3d'
              ? 'Database ER Schema (3D Relational Cube)'
              : `${activeLayers.length + 1}. Database ER Tables & Storage`,
          subtitle: 'SQL / ORM tables, primary keys, and foreign-key relationships',
          y: dbY - 2.6,
          radius: Math.max(24, dbRingRadius + 10),
          color: '#06b6d4',
          countLabel: `${tCount} ${tCount === 1 ? 'table' : 'tables'}`,
        });
      }

      visibleEntities.forEach((entity, idx) => {
        const tableNodeId = `er:${entity.id}`;
        const ownerInsight = fileInsightMap.get(entity.filePath);
        const clusterId = ownerInsight?.clusterId ?? 1;
        const cluster = clusterMap.get(clusterId);

        // If the entity maps to a visible file node in tower mode, align its angle near the file node
        const mappedFileItem = itemById.get(entity.filePath);
        let pos: THREE.Vector3;

        if (sceneMode === 'er3d') {
          if (tCount === 1) {
            pos = new THREE.Vector3(0, 0, 0);
          } else {
            const angle = (idx / tCount) * Math.PI * 2 - Math.PI / 2;
            const yWave = tCount > 3 ? Math.sin(idx * 1.7) * 7 : 0;
            pos = new THREE.Vector3(
              Math.cos(angle) * dbRingRadius,
              yWave,
              Math.sin(angle) * dbRingRadius
            );
          }
        } else if (mappedFileItem && sceneMode === 'constellation') {
          pos = mappedFileItem.position.clone().add(new THREE.Vector3(4, -7, 4));
        } else {
          const angle = (idx / Math.max(1, tCount)) * Math.PI * 2 - Math.PI / 3;
          pos = new THREE.Vector3(
            Math.cos(angle) * dbRingRadius,
            dbY,
            Math.sin(angle) * dbRingRadius
          );
        }

        const pkCols = entity.columns.filter((c) => c.primaryKey).length;
        const fkCols = entity.columns.filter((c) => c.foreignKey).length;

        const item: Node3DItem = {
          id: tableNodeId,
          kind: 'table',
          label: entity.tableName,
          sublabel: `Table · ${entity.columns.length} cols (${pkCols} PK, ${fkCols} FK)`,
          role: 'DB_TABLE',
          layerKey: 'Database ER Layer',
          color: '#22d3ee',
          clusterColor: getClusterColor(clusterId),
          clusterId,
          clusterName: cluster?.name ?? 'Persistence Schema',
          importance: 0.75,
          confidence: 0.96,
          inCycle: false,
          isCited: citedFileMap.has(entity.filePath),
          citationLines: citedFileMap.get(entity.filePath),
          lineCount: entity.endLine - entity.startLine + 1,
          fanIn: fkCols,
          fanOut: pkCols,
          summary: `Database table '${entity.tableName}' mapped from ${entity.className} (${entity.columns.length} columns)`,
          reasons: [
            `Mapped from ${entity.filePath} (L${entity.startLine}-L${entity.endLine})`,
          ],
          symbols: entity.columns.slice(0, 6).map((c) => `${c.name}:${c.sqlType}`),
          position: pos,
          radius: 2.1 + Math.min(1.2, entity.columns.length * 0.1),
          erEntity: entity,
        };
        nodeItems.push(item);
        itemById.set(tableNodeId, item);
      });
    }

    // Build 3D Edges (File dependencies + ORM File->Table links + ER Table<->Table relations)
    const downHops = impactReport?.downstreamHops ?? new Map<string, number>();
    const upHops = impactReport?.upstreamHops ?? new Map<string, number>();
    const activeSelectionId =
      sceneMode === 'er3d' && selectedEntityId
        ? `er:${selectedEntityId}`
        : selectedFilePath && itemById.has(selectedFilePath)
        ? selectedFilePath
        : selectedEntityId && itemById.has(`er:${selectedEntityId}`)
        ? `er:${selectedEntityId}`
        : null;

    const edgeList: Edge3DItem[] = [];

    // 1. Code dependency edges
    if (sceneMode !== 'er3d' && graphData) {
      for (const e of graphData.edges) {
        if (!itemById.has(e.source) || !itemById.has(e.target) || e.source === e.target) {
          continue;
        }
        const edgeKey = `${e.source}->${e.target}`;
        const isViolation = violationEdgeKeys.has(edgeKey);
        const violation = violationMap.get(edgeKey);
        const isApi = e.relationType === 'API_CALL';

        const isDirect = e.source === activeSelectionId || e.target === activeSelectionId;
        const isImpactChain =
          impactMode &&
          ((downHops.has(e.source) && (e.target === selectedFilePath || downHops.has(e.target))) ||
            (upHops.has(e.target) && (e.source === selectedFilePath || upHops.has(e.source))));

        const isHighlighted = isDirect || isImpactChain || isViolation;
        const isDimmed = Boolean(activeSelectionId) && !isHighlighted;

        const color = isViolation
          ? '#f43f5e'
          : isImpactChain
          ? '#f59e0b'
          : isDirect
          ? '#818cf8'
          : isApi
          ? '#ec4899'
          : '#64748b';

        edgeList.push({
          id: e.id,
          source: e.source,
          target: e.target,
          kind: isViolation
            ? 'violation'
            : isApi
            ? 'api_call'
            : e.relationType === 'INJECTION'
            ? 'injection'
            : 'import',
          label: isViolation ? violation?.reason ?? 'Layer violation' : e.relationType,
          color,
          isHighlighted,
          isDimmed,
        });
      }
    }

    // 2. ORM File -> Database Table bridge links
    if (sceneMode !== 'er3d') {
      for (const entity of visibleEntities) {
        const tableNodeId = `er:${entity.id}`;
        if (itemById.has(entity.filePath) && itemById.has(tableNodeId)) {
          const isDirect =
            activeSelectionId === entity.filePath || activeSelectionId === tableNodeId;
          edgeList.push({
            id: `orm-map-${entity.id}`,
            source: entity.filePath,
            target: tableNodeId,
            kind: 'orm_map',
            label: `maps to table ${entity.tableName}`,
            color: isDirect ? '#22d3ee' : '#0891b2',
            isHighlighted: isDirect,
            isDimmed: Boolean(activeSelectionId) && !isDirect,
          });
        }
      }
    }

    // 3. Database ER Table <-> Table relationships (Declared + AI/Algo Inferred)
    if (erDiagram) {
      for (const rel of erDiagram.relations) {
        const srcId = `er:${rel.source}`;
        const tgtId = `er:${rel.target}`;
        if (!itemById.has(srcId) || !itemById.has(tgtId) || srcId === tgtId) continue;

        const inferred = inferredErMap.get(rel.id);
        const isDirect = activeSelectionId === srcId || activeSelectionId === tgtId;
        const color = inferred
          ? isDirect
            ? '#34d399'
            : '#10b981'
          : isDirect
          ? '#38bdf8'
          : '#06b6d4';

        edgeList.push({
          id: `er-rel-${rel.id}`,
          source: srcId,
          target: tgtId,
          kind: inferred ? 'er_inferred' : 'er_fk',
          label: inferred
            ? `${CARDINALITY[rel.type]} (${inferred.origin} · ${Math.round(inferred.confidence * 100)}%)`
            : `${CARDINALITY[rel.type]} (${rel.fieldName})`,
          color,
          isHighlighted: isDirect || Boolean(inferred),
          isDimmed: Boolean(activeSelectionId) && !isDirect,
        });
      }
    }

    // Build "AI Agent Architecture Walkthrough" steps from top layer down to DB Table
    const steps: WalkthroughStep[] = [];
    const roleOrder: { role: string; title: string }[] = [
      { role: 'UI_COMPONENT', title: 'Presentation & UI Entrypoint' },
      { role: 'API_CLIENT', title: 'Frontend API Client Bridge' },
      { role: 'CONTROLLER', title: 'Backend REST Controller / Router' },
      { role: 'SERVICE', title: 'Core Business Logic & Orchestration' },
      { role: 'REPOSITORY', title: 'Data Access & Persistence Repository' },
      { role: 'MODEL', title: 'Domain Entity & Schema Model' },
      { role: 'DB_TABLE', title: 'Relational Database Table' },
    ];

    let stepNum = 1;
    for (const rSpec of roleOrder) {
      const candidates = nodeItems
        .filter((it) => it.role === rSpec.role)
        .sort((a, b) => b.importance - a.importance || b.fanIn + b.fanOut - (a.fanIn + a.fanOut));
      if (candidates.length > 0) {
        const pick = candidates[0];
        steps.push({
          stepNumber: stepNum++,
          nodeId: pick.id,
          kind: pick.kind,
          stageTitle: rSpec.title,
          headline: pick.label,
          explanation: pick.summary,
          badgeColor: pick.color,
        });
      }
    }

    return {
      items: nodeItems,
      edges: edgeList,
      platforms: platformList,
      walkthroughSteps: steps,
    };
  }, [
    graphData,
    erDiagram,
    fileInsightMap,
    clusterMap,
    violationEdgeKeys,
    violationMap,
    inferredErMap,
    citedFileMap,
    impactReport,
    impactMode,
    selectedFilePath,
    selectedEntityId,
    activeClusterId,
    query,
    roleFilter,
    sceneMode,
  ]);

  // Focus camera on a 3D position when a node is selected or walkthrough steps
  const focusCameraOn = useCallback((pos: THREE.Vector3, distance = 58) => {
    cameraStateRef.current.desiredTarget.copy(pos);
    cameraStateRef.current.desiredRadius = distance;
  }, []);

  const resetCamera = useCallback(() => {
    cameraStateRef.current.desiredTarget.set(0, 0, 0);
    cameraStateRef.current.desiredRadius = sceneMode === 'er3d' ? 95 : 135;
    cameraStateRef.current.theta = 0.55;
    cameraStateRef.current.phi = 1.12;
  }, [sceneMode]);

  // Auto-advance walkthrough when playing
  useEffect(() => {
    if (!walkthroughPlaying || walkthroughSteps.length === 0) return;
    const timer = window.setInterval(() => {
      setWalkthroughIndex((prev) => {
        const next = prev === null ? 0 : (prev + 1) % walkthroughSteps.length;
        return next;
      });
    }, 4200);
    return () => window.clearInterval(timer);
  }, [walkthroughPlaying, walkthroughSteps.length]);

  // Sync camera & selection when walkthroughIndex changes
  useEffect(() => {
    if (walkthroughIndex === null || !walkthroughSteps[walkthroughIndex]) return;
    const step = walkthroughSteps[walkthroughIndex];
    const targetItem = items.find((i) => i.id === step.nodeId);
    if (targetItem) {
      focusCameraOn(targetItem.position, 52);
      if (targetItem.kind === 'file' && targetItem.fileNode) {
        onSelectFile(targetItem.fileNode.path);
      } else if (targetItem.kind === 'table' && targetItem.erEntity) {
        onSelectEntity(targetItem.erEntity);
      }
    }
  }, [walkthroughIndex, walkthroughSteps, items, focusCameraOn, onSelectFile, onSelectEntity]);

  // Main Three.js Scene setup & animation loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isDark ? '#020617' : '#f1f5f9');
    scene.fog = new THREE.FogExp2(isDark ? '#020617' : '#f1f5f9', 0.0028);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.5, 900);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(isDark ? 0xffffff : 0xffffff, isDark ? 0.78 : 0.92);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x818cf8, isDark ? 1.35 : 1.0);
    dirLight1.position.set(70, 120, 80);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x22d3ee, isDark ? 0.95 : 0.7);
    dirLight2.position.set(-80, -60, -70);
    scene.add(dirLight2);

    // Subtle background starfield / grid reference
    if (isDark) {
      const starGeo = new THREE.BufferGeometry();
      const starCount = 320;
      const starPositions = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i++) {
        const r = 180 + Math.random() * 160;
        const t = Math.random() * Math.PI * 2;
        const p = Math.acos(2 * Math.random() - 1);
        starPositions[i * 3] = r * Math.sin(p) * Math.cos(t);
        starPositions[i * 3 + 1] = r * Math.cos(p);
        starPositions[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
      }
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
      const starMat = new THREE.PointsMaterial({
        color: 0x475569,
        size: 1.1,
        transparent: true,
        opacity: 0.55,
      });
      scene.add(new THREE.Points(starGeo, starMat));
    }

    // 1. Render Layer Platforms (in 'tower' and 'er3d' modes)
    const platformGroup = new THREE.Group();
    if (showPlatforms) {
      for (const plat of platforms) {
        const ringGeo = new THREE.CylinderGeometry(plat.radius, plat.radius, 0.45, 64);
        const ringMat = new THREE.MeshPhongMaterial({
          color: new THREE.Color(plat.color),
          transparent: true,
          opacity: isDark ? 0.08 : 0.11,
          depthWrite: false,
        });
        const disc = new THREE.Mesh(ringGeo, ringMat);
        disc.position.set(0, plat.y, 0);
        platformGroup.add(disc);

        // Glowing outer border ring
        const torusGeo = new THREE.TorusGeometry(plat.radius, 0.18, 12, 96);
        const torusMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(plat.color),
          transparent: true,
          opacity: isDark ? 0.42 : 0.5,
        });
        const borderRing = new THREE.Mesh(torusGeo, torusMat);
        borderRing.rotation.x = Math.PI / 2;
        borderRing.position.set(0, plat.y, 0);
        platformGroup.add(borderRing);

        if (showLabels) {
          const labelSprite = createPlatformLabelSprite(plat.title, plat.countLabel, plat.color);
          labelSprite.position.set(-plat.radius - 6, plat.y + 1.8, 0);
          platformGroup.add(labelSprite);
        }
      }
    }
    scene.add(platformGroup);

    // 2. Render Cluster Halos in 'constellation' mode
    if (sceneMode === 'constellation' && showPlatforms) {
      const byCluster = new Map<number, Node3DItem[]>();
      for (const it of items) {
        const list = byCluster.get(it.clusterId) ?? [];
        list.push(it);
        byCluster.set(it.clusterId, list);
      }
      for (const [cid, members] of byCluster.entries()) {
        if (members.length < 2) continue;
        const center = new THREE.Vector3();
        members.forEach((m) => center.add(m.position));
        center.divideScalar(members.length);
        let maxDist = 8;
        members.forEach((m) => {
          maxDist = Math.max(maxDist, center.distanceTo(m.position) + 4);
        });
        const cColor = getClusterColor(cid);
        const haloGeo = new THREE.SphereGeometry(maxDist, 24, 24);
        const haloMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(cColor),
          transparent: true,
          opacity: isDark ? 0.05 : 0.07,
          wireframe: true,
          depthWrite: false,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.copy(center);
        scene.add(halo);
      }
    }

    // 3. Render 3D Nodes (Files & Database ER Tables)
    const interactableMeshes: THREE.Object3D[] = [];
    const meshToItem = new Map<THREE.Object3D, Node3DItem>();
    const selectedMeshes: THREE.Object3D[] = [];

    const activeSelectionId =
      sceneMode === 'er3d' && selectedEntityId
        ? `er:${selectedEntityId}`
        : selectedFilePath || (selectedEntityId ? `er:${selectedEntityId}` : null);

    const itemMap = new Map(items.map((i) => [i.id, i]));

    for (const item of items) {
      const isSelected =
        item.id === activeSelectionId ||
        (item.kind === 'table' && item.erEntity?.id === selectedEntityId) ||
        (item.kind === 'file' && item.fileNode?.path === selectedFilePath);

      const baseHex =
        colorMode === 'cluster'
          ? item.clusterColor
          : colorMode === 'importance'
          ? item.importance >= 0.75
            ? '#f59e0b'
            : item.importance >= 0.45
            ? '#6366f1'
            : '#38bdf8'
          : item.color;

      const nodeGroup = new THREE.Group();
      nodeGroup.position.copy(item.position);

      let primaryMesh: THREE.Mesh;

      if (item.kind === 'table') {
        // 3-platter Database Cylinder Stack + golden PK ring
        const platterMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(baseHex),
          emissive: new THREE.Color(baseHex),
          emissiveIntensity: isSelected ? 0.55 : 0.22,
          roughness: 0.25,
          metalness: 0.35,
        });
        const bodyGeo = new THREE.CylinderGeometry(item.radius, item.radius, item.radius * 1.45, 28);
        primaryMesh = new THREE.Mesh(bodyGeo, platterMat);
        nodeGroup.add(primaryMesh);

        // Golden Primary Key crown ring
        const pkRingGeo = new THREE.TorusGeometry(item.radius * 1.06, 0.18, 12, 36);
        const pkRingMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
        const pkRing = new THREE.Mesh(pkRingGeo, pkRingMat);
        pkRing.rotation.x = Math.PI / 2;
        pkRing.position.y = item.radius * 0.55;
        nodeGroup.add(pkRing);

        // Indigo Foreign Key middle ring
        const fkRing = new THREE.Mesh(
          pkRingGeo,
          new THREE.MeshBasicMaterial({ color: 0x818cf8 })
        );
        fkRing.rotation.x = Math.PI / 2;
        fkRing.position.y = 0;
        nodeGroup.add(fkRing);
      } else {
        // Differentiate 3D geometry by architectural role
        let geo: THREE.BufferGeometry;
        switch (item.role) {
          case 'UI_COMPONENT':
            geo = new THREE.OctahedronGeometry(item.radius * 1.15, 1);
            break;
          case 'API_CLIENT':
            geo = new THREE.TorusGeometry(item.radius * 0.85, item.radius * 0.34, 16, 32);
            break;
          case 'CONTROLLER':
            geo = new THREE.DodecahedronGeometry(item.radius * 1.1, 0);
            break;
          case 'SERVICE':
            geo = new THREE.CylinderGeometry(item.radius, item.radius, item.radius * 1.3, 6);
            break;
          case 'REPOSITORY':
            geo = new THREE.CylinderGeometry(item.radius * 0.95, item.radius * 0.95, item.radius * 1.4, 20);
            break;
          case 'MODEL':
            geo = new THREE.IcosahedronGeometry(item.radius * 1.08, 0);
            break;
          default:
            geo = new THREE.BoxGeometry(item.radius * 1.4, item.radius * 1.4, item.radius * 1.4);
            break;
        }

        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(baseHex),
          emissive: new THREE.Color(item.isCited ? '#10b981' : baseHex),
          emissiveIntensity: isSelected ? 0.6 : item.isCited ? 0.42 : 0.18,
          roughness: 0.28,
          metalness: 0.25,
        });
        primaryMesh = new THREE.Mesh(geo, mat);
        nodeGroup.add(primaryMesh);
      }

      // Selection / Citation / Cycle outer orbital halo
      if (isSelected || item.isCited || item.inCycle) {
        const haloColor = isSelected
          ? 0x818cf8
          : item.inCycle
          ? 0xf43f5e
          : 0x10b981;
        const haloGeo = new THREE.TorusGeometry(item.radius * 1.55, 0.16, 12, 48);
        const haloMat = new THREE.MeshBasicMaterial({
          color: haloColor,
          transparent: true,
          opacity: 0.85,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.rotation.x = Math.PI / 2;
        nodeGroup.add(halo);
        selectedMeshes.push(halo);
      }

      // Floating billboard label
      if (showLabels) {
        const badge = item.inCycle
          ? '⟳ CYCLE'
          : item.isCited
          ? '★ CITED'
          : item.importance >= 0.8
          ? '★ HUB'
          : undefined;
        const sprite = createTextSprite(
          item.label,
          item.sublabel,
          baseHex,
          isSelected,
          isDark,
          badge
        );
        sprite.position.set(0, item.radius + 2.8, 0);
        nodeGroup.add(sprite);
      }

      scene.add(nodeGroup);
      interactableMeshes.push(primaryMesh);
      meshToItem.set(primaryMesh, item);
    }

    // 4. Render 3D Curved Edges + Animated Flow Particles
    const particleCurves: {
      curve: THREE.QuadraticBezierCurve3;
      offset: number;
      speed: number;
      color: THREE.Color;
    }[] = [];

    for (const edge of edges) {
      const src = itemMap.get(edge.source);
      const tgt = itemMap.get(edge.target);
      if (!src || !tgt) continue;

      const start = src.position.clone();
      const end = tgt.position.clone();
      const mid = start.clone().add(end).multiplyScalar(0.5);

      // Arc outward or upward so same-plane edges curve gracefully
      const dist = start.distanceTo(end);
      const horizontalOffset = new THREE.Vector3(mid.x, 0, mid.z);
      if (horizontalOffset.lengthSq() > 1) {
        horizontalOffset.normalize().multiplyScalar(Math.min(12, dist * 0.18));
      } else {
        horizontalOffset.set(dist * 0.15, 0, dist * 0.15);
      }
      mid.add(horizontalOffset);
      if (Math.abs(start.y - end.y) < 3) {
        mid.y += Math.min(8, dist * 0.22);
      }

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(28);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(edge.color),
        transparent: true,
        opacity: edge.isDimmed ? 0.12 : edge.isHighlighted ? 0.92 : 0.45,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);

      // Directional arrowhead cone near target
      if (!edge.isDimmed) {
        const tipPos = curve.getPoint(0.88);
        const tangent = curve.getTangent(0.88).normalize();
        const coneGeo = new THREE.ConeGeometry(edge.isHighlighted ? 0.72 : 0.48, 1.8, 10);
        const coneMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(edge.color),
          transparent: true,
          opacity: edge.isHighlighted ? 0.95 : 0.65,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.copy(tipPos);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        scene.add(cone);
      }

      // Register animated data flow particles along non-dimmed edges
      if (showParticles && !edge.isDimmed) {
        const numParticles = edge.isHighlighted ? 2 : 1;
        for (let p = 0; p < numParticles; p++) {
          particleCurves.push({
            curve,
            offset: (p / numParticles + Math.random() * 0.3) % 1,
            speed: edge.isHighlighted ? 0.0065 : 0.004,
            color: new THREE.Color(edge.color),
          });
        }
      }
    }

    let particlePoints: THREE.Points | null = null;
    let particlePositions: Float32Array | null = null;

    if (showParticles && particleCurves.length > 0) {
      const pCount = particleCurves.length;
      particlePositions = new Float32Array(pCount * 3);
      const particleColors = new Float32Array(pCount * 3);

      particleCurves.forEach((pc, idx) => {
        const pt = pc.curve.getPoint(pc.offset);
        particlePositions![idx * 3] = pt.x;
        particlePositions![idx * 3 + 1] = pt.y;
        particlePositions![idx * 3 + 2] = pt.z;
        particleColors[idx * 3] = pc.color.r;
        particleColors[idx * 3 + 1] = pc.color.g;
        particleColors[idx * 3 + 2] = pc.color.b;
      });

      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
      pGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

      const pMat = new THREE.PointsMaterial({
        size: 2.3,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
      });
      particlePoints = new THREE.Points(pGeo, pMat);
      scene.add(particlePoints);
    }

    // Raycaster & Mouse Interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const domEl = renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      const st = cameraStateRef.current;
      st.isDragging = true;
      st.dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      st.prevX = e.clientX;
      st.prevY = e.clientY;
      st.pointerDownX = e.clientX;
      st.pointerDownY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      const st = cameraStateRef.current;
      const rect = domEl.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (st.isDragging) {
        const dx = e.clientX - st.prevX;
        const dy = e.clientY - st.prevY;
        st.prevX = e.clientX;
        st.prevY = e.clientY;

        if (st.dragMode === 'orbit') {
          st.theta -= dx * 0.0075;
          st.phi = Math.max(0.18, Math.min(Math.PI - 0.18, st.phi - dy * 0.0075));
        } else {
          const panScale = st.radius * 0.0016;
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
          const up = new THREE.Vector3().crossVectors(right, forward).normalize();
          st.desiredTarget.addScaledVector(right, -dx * panScale);
          st.desiredTarget.addScaledVector(up, dy * panScale);
        }
        return;
      }

      // Hover raycasting
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(interactableMeshes, false);
      if (hits.length > 0) {
        const hitItem = meshToItem.get(hits[0].object) ?? null;
        setHoveredItem(hitItem);
        domEl.style.cursor = 'pointer';
      } else {
        setHoveredItem(null);
        domEl.style.cursor = 'grab';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const st = cameraStateRef.current;
      const movedDist = Math.hypot(e.clientX - st.pointerDownX, e.clientY - st.pointerDownY);
      st.isDragging = false;

      if (movedDist < 5 && e.button === 0) {
        const rect = domEl.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(interactableMeshes, false);
        if (hits.length > 0) {
          const clicked = meshToItem.get(hits[0].object);
          if (clicked) {
            focusCameraOn(clicked.position, Math.max(48, st.desiredRadius * 0.72));
            if (clicked.kind === 'file' && clicked.fileNode) {
              onSelectFile(clicked.fileNode.path);
            } else if (clicked.kind === 'table' && clicked.erEntity) {
              onSelectEntity(clicked.erEntity);
            }
          }
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = cameraStateRef.current;
      st.desiredRadius = Math.max(24, Math.min(280, st.desiredRadius + e.deltaY * 0.09));
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    domEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domEl.addEventListener('wheel', onWheel, { passive: false });
    domEl.addEventListener('contextmenu', onContextMenu);

    // ResizeObserver for responsive pane splitting
    const resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObs.observe(container);

    // Animation loop
    let animId = 0;
    const animate = () => {
      animId = window.requestAnimationFrame(animate);
      const st = cameraStateRef.current;

      if (autoRotate && !st.isDragging) {
        st.theta += 0.0028;
      }

      // Smooth damping toward desired target & radius
      st.target.lerp(st.desiredTarget, 0.08);
      st.radius += (st.desiredRadius - st.radius) * 0.08;

      const camX = st.target.x + st.radius * Math.sin(st.phi) * Math.sin(st.theta);
      const camY = st.target.y + st.radius * Math.cos(st.phi);
      const camZ = st.target.z + st.radius * Math.sin(st.phi) * Math.cos(st.theta);
      camera.position.set(camX, camY, camZ);
      camera.lookAt(st.target);

      // Pulse selected orbital rings
      selectedMeshes.forEach((m) => {
        m.rotation.z += 0.015;
      });

      // Advance flow particles along curves
      if (particlePoints && particlePositions) {
        for (let i = 0; i < particleCurves.length; i++) {
          const pc = particleCurves[i];
          pc.offset = (pc.offset + pc.speed) % 1;
          const pt = pc.curve.getPoint(pc.offset);
          particlePositions[i * 3] = pt.x;
          particlePositions[i * 3 + 1] = pt.y;
          particlePositions[i * 3 + 2] = pt.z;
        }
        (particlePoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(animId);
      resizeObs.disconnect();
      domEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domEl.removeEventListener('wheel', onWheel);
      domEl.removeEventListener('contextmenu', onContextMenu);
      renderer.dispose();
    };
  }, [
    items,
    edges,
    platforms,
    sceneMode,
    colorMode,
    showLabels,
    showParticles,
    showPlatforms,
    autoRotate,
    isDark,
    selectedFilePath,
    selectedEntityId,
    focusCameraOn,
    onSelectFile,
    onSelectEntity,
  ]);

  const activeWalkthroughStep =
    walkthroughIndex !== null ? walkthroughSteps[walkthroughIndex] ?? null : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 select-none">
      {/* Three.js WebGL Mount */}
      <div ref={mountRef} className="h-full w-full" />

      {/* Top-Left 3D Mode & Visual Controls HUD */}
      <div className="pointer-events-auto absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 3D Topology Mode Switcher */}
          <div className="flex rounded-lg border border-slate-700/90 bg-slate-900/90 p-0.5 text-[11px] shadow-xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setSceneMode('tower');
                resetCamera();
              }}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                sceneMode === 'tower'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="3D Layered Architecture Tower stacked above the Database ER Foundation"
            >
              <Layers className="h-3.5 w-3.5" />
              3D Tower + DB
            </button>
            <button
              type="button"
              onClick={() => {
                setSceneMode('constellation');
                resetCamera();
              }}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                sceneMode === 'constellation'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="3D Module Cluster Constellation grouping cohesive domain files in 3D space"
            >
              <Orbit className="h-3.5 w-3.5" />
              Cluster Galaxy
            </button>
            <button
              type="button"
              onClick={() => {
                setSceneMode('er3d');
                resetCamera();
              }}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                sceneMode === 'er3d'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Dedicated 3D Database ER Relational Explorer"
            >
              <Database className="h-3.5 w-3.5" />
              3D Database ER
            </button>
          </div>

          {/* Color Encoding Switcher */}
          {sceneMode !== 'er3d' && (
            <div className="flex rounded-lg border border-slate-700/90 bg-slate-900/90 p-0.5 text-[11px] shadow-xl backdrop-blur-md">
              <button
                type="button"
                onClick={() => setColorMode('layer')}
                className={`rounded-md px-2 py-1 font-medium transition ${
                  colorMode === 'layer'
                    ? 'bg-slate-800 text-indigo-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Color nodes by architectural layer & role"
              >
                Role Color
              </button>
              <button
                type="button"
                onClick={() => setColorMode('cluster')}
                className={`rounded-md px-2 py-1 font-medium transition ${
                  colorMode === 'cluster'
                    ? 'bg-slate-800 text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Color nodes by discovered Domain Module Cluster"
              >
                Cluster Color
              </button>
              <button
                type="button"
                onClick={() => setColorMode('importance')}
                className={`rounded-md px-2 py-1 font-medium transition ${
                  colorMode === 'importance'
                    ? 'bg-slate-800 text-amber-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Color nodes by PageRank architectural importance"
              >
                PageRank Hub
              </button>
            </div>
          )}

          {/* Scene Toggles */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-700/90 bg-slate-900/90 p-0.5 text-[11px] shadow-xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => setShowParticles((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                showParticles ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle animated request & data flow particles along 3D edges"
            >
              <Zap className="h-3 w-3" />
              Flow Pulse
            </button>
            <button
              type="button"
              onClick={() => setShowPlatforms((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                showPlatforms ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle 3D layer platforms and cluster halos"
            >
              <Layers className="h-3 w-3" />
              Decks
            </button>
            <button
              type="button"
              onClick={() => setShowLabels((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                showLabels ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle floating 3D labels"
            >
              {showLabels ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              Labels
            </button>
            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                autoRotate ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Auto-orbit the 3D camera"
            >
              <Compass className="h-3 w-3" />
              Orbit
            </button>
            <button
              type="button"
              onClick={resetCamera}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Reset 3D camera view"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
        </div>

        {/* AI Agent Story Walkthrough Trigger Bar */}
        {walkthroughSteps.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-500/35 bg-slate-900/95 px-2.5 py-1.5 text-[11px] shadow-xl backdrop-blur-md">
            <span className="inline-flex items-center gap-1 font-semibold text-indigo-300">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              AI Project Flow Tour:
            </span>
            {walkthroughIndex === null ? (
              <button
                type="button"
                onClick={() => {
                  setWalkthroughIndex(0);
                  setWalkthroughPlaying(true);
                }}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-0.5 font-semibold text-white transition hover:bg-indigo-500"
              >
                <Play className="h-3 w-3" />
                Trace Request → DB ({walkthroughSteps.length} steps)
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setWalkthroughPlaying(false);
                    setWalkthroughIndex((prev) =>
                      prev === null
                        ? 0
                        : (prev - 1 + walkthroughSteps.length) % walkthroughSteps.length
                    );
                  }}
                  className="rounded border border-slate-700 bg-slate-800 p-1 text-slate-200 hover:border-indigo-400"
                  title="Previous architectural stage"
                >
                  <StepBack className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setWalkthroughPlaying((v) => !v)}
                  className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/20 px-2 py-0.5 font-semibold text-indigo-200"
                >
                  {walkthroughPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  Step {walkthroughIndex + 1}/{walkthroughSteps.length}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWalkthroughPlaying(false);
                    setWalkthroughIndex((prev) =>
                      prev === null ? 0 : (prev + 1) % walkthroughSteps.length
                    );
                  }}
                  className="rounded border border-slate-700 bg-slate-800 p-1 text-slate-200 hover:border-indigo-400"
                  title="Next architectural stage"
                >
                  <StepForward className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWalkthroughPlaying(false);
                    setWalkthroughIndex(null);
                    resetCamera();
                  }}
                  className="ml-1 text-[10px] text-slate-400 underline hover:text-slate-200"
                >
                  Exit tour
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Walkthrough Narrative Card */}
      {activeWalkthroughStep && (
        <div className="pointer-events-auto absolute bottom-4 left-3 z-20 max-w-md rounded-xl border border-indigo-500/45 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
              style={{ backgroundColor: activeWalkthroughStep.badgeColor }}
            >
              Stage {activeWalkthroughStep.stepNumber} · {activeWalkthroughStep.stageTitle}
            </span>
            <span className="text-[10px] text-slate-400">
              {activeWalkthroughStep.kind === 'table' ? 'Database Table' : 'Code Component'}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-xs font-bold text-slate-100">
            {activeWalkthroughStep.headline}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            {activeWalkthroughStep.explanation}
          </p>
        </div>
      )}

      {/* Hover Tooltip Card */}
      {hoveredItem && (
        <div className="pointer-events-none absolute right-3 top-3 z-20 w-72 rounded-xl border border-slate-700/90 bg-slate-900/95 p-3 text-xs shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
              style={{ backgroundColor: hoveredItem.color }}
            >
              {hoveredItem.kind === 'table' ? 'DB Table' : getRoleMeta(hoveredItem.role).label}
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              Confidence {Math.round(hoveredItem.confidence * 100)}% · Rank{' '}
              {Math.round(hoveredItem.importance * 100)}%
            </span>
          </div>
          <div className="mt-1.5 truncate font-mono text-xs font-bold text-slate-100">
            {hoveredItem.label}
          </div>
          <div className="truncate text-[10px] text-indigo-300">{hoveredItem.clusterName}</div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-300">{hoveredItem.summary}</p>
          {hoveredItem.reasons.length > 0 && (
            <div className="mt-2 border-t border-slate-800 pt-1.5 text-[10px] text-slate-400">
              <span className="font-semibold text-slate-300">Why: </span>
              {hoveredItem.reasons[0]}
            </div>
          )}
          {hoveredItem.symbols.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {hoveredItem.symbols.slice(0, 4).map((s) => (
                <span
                  key={s}
                  className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-300"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom-Right Controls Hint */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-900/85 px-3 py-1.5 text-[10px] text-slate-400 backdrop-blur sm:flex">
        <span className="inline-flex items-center gap-1">
          <Box className="h-3 w-3 text-indigo-400" />
          <strong>Left-drag</strong> Orbit
        </span>
        <span>
          <strong>Right-drag / Shift</strong> Pan
        </span>
        <span>
          <strong>Scroll</strong> Zoom
        </span>
        <span>
          <strong>Click node</strong> Inspect code
        </span>
      </div>
    </div>
  );
}
