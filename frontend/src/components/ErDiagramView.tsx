import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Database } from 'lucide-react';
import type { ErColumn, ErDiagram, ErEntity, InferredErRelationDto } from '../types/api';
import { ErTableNode, type ErTableNodeData } from './ErTableNode';
import { CARDINALITY, edgeSides, layoutEntities } from '../lib/erLayout';
import { useTheme } from '../lib/theme';

const nodeTypes = { erTable: ErTableNode };

interface ErDiagramViewProps {
  diagram: ErDiagram | null;
  inferredById?: Map<string, InferredErRelationDto>;
  /** True once the request has finished (so `diagram === null` means it failed). */
  loaded: boolean;
  query: string;
  selectedEntityId: string | null;
  highlightedColumn: string | null;
  expanded: boolean;
  onSelectEntity: (entity: ErEntity) => void;
  onSelectColumn: (entity: ErEntity, column: ErColumn) => void;
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-400">
      <Database className="mb-3 h-9 w-9 text-slate-700" />
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed">{text}</p>
    </div>
  );
}

/** Database diagram (tables, columns and relationships) built from the repository's JPA entities. */
export function ErDiagramView({
  diagram,
  inferredById,
  loaded,
  query,
  selectedEntityId,
  highlightedColumn,
  expanded,
  onSelectEntity,
  onSelectColumn,
}: ErDiagramViewProps) {
  const { theme, isDark } = useTheme();

  const { nodes, edges } = useMemo(() => {
    if (!diagram) return { nodes: [] as Node[], edges: [] as Edge[] };

    const q = query.trim().toLowerCase();
    const visible = diagram.entities.filter(
      (e) =>
        !q ||
        e.tableName.toLowerCase().includes(q) ||
        e.className.toLowerCase().includes(q) ||
        e.columns.some((c) => c.name.toLowerCase().includes(q))
    );
    const visibleIds = new Set(visible.map((e) => e.id));
    const relations = diagram.relations.filter(
      (r) => r.source !== r.target && visibleIds.has(r.source) && visibleIds.has(r.target)
    );

    const layout = layoutEntities(visible, relations);

    const related = new Set<string>();
    if (selectedEntityId) {
      related.add(selectedEntityId);
      for (const r of relations) {
        if (r.source === selectedEntityId) related.add(r.target);
        if (r.target === selectedEntityId) related.add(r.source);
      }
    }
    const hasFocus = !!selectedEntityId && visibleIds.has(selectedEntityId);

    const nodes: Node[] = visible.map((entity) => {
      const data: ErTableNodeData = {
        entity,
        isSelected: entity.id === selectedEntityId,
        isDimmed: hasFocus && !related.has(entity.id),
        highlightedColumn: entity.id === selectedEntityId ? highlightedColumn : null,
        onSelectColumn,
      };
      return {
        id: entity.id,
        type: 'erTable',
        position: layout.positions.get(entity.id) ?? { x: 0, y: 0 },
        data,
      };
    });

    const edges: Edge[] = relations.map((r) => {
      const sourcePos = layout.positions.get(r.source)!;
      const targetPos = layout.positions.get(r.target)!;
      const { sourceSide, targetSide } = edgeSides(
        sourcePos,
        targetPos,
        layout.rows.get(r.source) ?? 0,
        layout.rows.get(r.target) ?? 0
      );
      const connected = r.source === selectedEntityId || r.target === selectedEntityId;
      const inferred = inferredById?.get(r.id);
      const color = inferred
        ? connected
          ? '#34d399'
          : '#10b981'
        : connected
        ? isDark
          ? '#818cf8'
          : '#4f46e5'
        : isDark
        ? '#64748b'
        : '#94a3b8';
      const label = inferred
        ? `${CARDINALITY[r.type]} · ${inferred.origin === 'ollama' ? 'AI' : 'Algo'} ${Math.round(
            inferred.confidence * 100
          )}%`
        : CARDINALITY[r.type];
      return {
        id: r.id,
        source: r.source,
        target: r.target,
        sourceHandle: `${sourceSide}-source`,
        targetHandle: `${targetSide}-target`,
        type: 'smoothstep',
        label,
        animated: connected || Boolean(inferred),
        labelStyle: {
          fill: inferred ? (isDark ? '#6ee7b7' : '#047857') : isDark ? '#e2e8f0' : '#0f172a',
          fontSize: 10,
          fontWeight: 700,
        },
        labelBgStyle: {
          fill: isDark ? '#0f172a' : '#ffffff',
          fillOpacity: 0.95,
        },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: color,
          strokeWidth: connected ? 2.4 : inferred ? 2.0 : 1.6,
          strokeDasharray: r.type === 'MANY_TO_MANY' || inferred ? '6 4' : undefined,
          opacity: hasFocus && !connected ? 0.3 : 1,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      };
    });

    return { nodes, edges };
  }, [diagram, inferredById, query, selectedEntityId, highlightedColumn, onSelectColumn, isDark]);

  if (!loaded) {
    return (
      <Message
        title="Loading database diagram…"
        text="Extracting SQL tables, ORM models, vector collections, and data schemas from the repository."
      />
    );
  }
  if (!diagram) {
    return (
      <Message
        title="Couldn’t load the database diagram"
        text="The backend did not return the diagram. If you just updated VisualRepo, restart the backend and reload this page."
      />
    );
  }
  if (diagram.entities.length === 0) {
    return (
      <Message
        title="No database tables or data models found"
        text="This view extracts SQL CREATE TABLE schemas, Java JPA @Entity classes, Python SQLAlchemy/Django/Pydantic/@dataclass/VectorStore models, Prisma models, and TypeScript schemas."
      />
    );
  }
  if (nodes.length === 0) {
    return (
      <Message title="No tables match your search" text="Clear the search box to see every table again." />
    );
  }

  return (
    <ReactFlow
      key={`${diagram.repositoryId}-${nodes.length}-${expanded}`}
      colorMode={theme}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => {
        const entity = diagram.entities.find((e) => e.id === node.id);
        if (entity) onSelectEntity(entity);
      }}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.15}
      maxZoom={1.6}
    >
      <Background color={isDark ? '#1e293b' : '#cbd5e1'} gap={22} />
      <Controls showInteractive={false} className="!border-slate-700 !bg-slate-900 !text-slate-200" />
      {expanded && (
        <MiniMap
          nodeColor={(n) =>
            n.id === selectedEntityId ? '#6366f1' : isDark ? '#334155' : '#94a3b8'
          }
          maskColor={isDark ? 'rgba(2, 6, 23, 0.75)' : 'rgba(226, 232, 240, 0.75)'}
          className="!rounded-lg !border !border-slate-800 !bg-slate-900/90"
        />
      )}
    </ReactFlow>
  );
}
