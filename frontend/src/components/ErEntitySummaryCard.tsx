import { Code2, KeyRound, Link2, Sparkles, Table2 } from 'lucide-react';
import type { ErDiagram, ErEntity, InferredErRelationDto } from '../types/api';
import { CARDINALITY, describeRelation } from '../lib/erLayout';

interface ErEntitySummaryCardProps {
  entity: ErEntity;
  diagram: ErDiagram;
  inferredById?: Map<string, InferredErRelationDto>;
  expanded: boolean;
  onSelectEntityById: (id: string) => void;
  onExitExpanded: () => void;
}

export function ErEntitySummaryCard({
  entity,
  diagram,
  inferredById,
  expanded,
  onSelectEntityById,
  onExitExpanded,
}: ErEntitySummaryCardProps) {
  const byId = new Map(diagram.entities.map((e) => [e.id, e]));
  const nameOf = (id: string) => byId.get(id)?.tableName ?? id;
  const relations = diagram.relations.filter(
    (r) => r.source === entity.id || r.target === entity.id
  );
  const pkCount = entity.columns.filter((c) => c.primaryKey).length;
  const fkCount = entity.columns.filter((c) => c.foreignKey).length;

  return (
    <div className="space-y-1.5 border-t border-slate-800 bg-slate-900/85 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
            <Table2 className="h-3 w-3" />
            Table
          </span>
          <span className="truncate font-mono text-xs font-bold text-slate-100">{entity.tableName}</span>
          <span className="truncate text-[11px] text-slate-400">
            (class <code className="font-mono text-slate-200">{entity.className}</code> · L
            {entity.startLine}-L{entity.endLine})
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5">
            {entity.columns.length} columns
          </span>
          {pkCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
              <KeyRound className="h-3 w-3" />
              {pkCount} PK
            </span>
          )}
          {fkCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-indigo-300">
              <Link2 className="h-3 w-3" />
              {fkCount} FK
            </span>
          )}
          {expanded && (
            <button
              onClick={onExitExpanded}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500"
            >
              <Code2 className="h-3.5 w-3.5" />
              View code
            </button>
          )}
        </div>
      </div>

      {relations.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          Standalone table — no foreign-key relationships to other JPA entities. Click any column row in
          the table to jump to its field definition in the source code.
        </p>
      ) : (
        <ul className="space-y-1 text-[11px] text-slate-300">
          {relations.map((r) => {
            const otherId = r.source === entity.id ? r.target : r.source;
            const other = byId.get(otherId);
            const inferred = inferredById?.get(r.id);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-300">
                  {CARDINALITY[r.type]}
                </span>
                {inferred && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded border border-emerald-500/35 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300"
                    title={inferred.evidence}
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    {inferred.origin === 'ollama' ? 'Ollama AI' : 'Algo'} ·{' '}
                    {Math.round(inferred.confidence * 100)}%
                  </span>
                )}
                <span>{describeRelation(r, entity.id, nameOf)}</span>
                {other && (
                  <button
                    onClick={() => onSelectEntityById(other.id)}
                    className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300 hover:border-cyan-500/40 hover:text-slate-100"
                  >
                    → {other.tableName}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
