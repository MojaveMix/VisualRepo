import { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Boxes,
  ChevronDown,
  ChevronUp,
  Cpu,
  GitMerge,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type {
  InsightEngine,
  ProjectInsights,
  SystemStatus,
} from '../types/api';
import { getClusterColor } from '../lib/deepInsightsClient';

interface DeepInsightsBarProps {
  insights: ProjectInsights | null;
  engine: InsightEngine;
  selectedModel: string;
  loading: boolean;
  systemStatus: SystemStatus | null;
  activeClusterId: number | null;
  showInferredEr: boolean;
  onChangeEngine: (engine: InsightEngine) => void;
  onChangeModel: (model: string) => void;
  onRefresh: () => void;
  onSelectCluster: (clusterId: number | null) => void;
  onToggleInferredEr: () => void;
  onSelectFile: (filePath: string) => void;
  onSelectEntityById: (entityId: string) => void;
}

export function DeepInsightsBar({
  insights,
  engine,
  selectedModel,
  loading,
  systemStatus,
  activeClusterId,
  showInferredEr,
  onChangeEngine,
  onChangeModel,
  onRefresh,
  onSelectCluster,
  onToggleInferredEr,
  onSelectFile,
  onSelectEntityById,
}: DeepInsightsBarProps) {
  const [expanded, setExpanded] = useState(false);

  const availableModels = systemStatus?.availableOllamaModels ?? [];
  const ollamaOnline = systemStatus?.ollamaOnline ?? false;

  const clusterCount = insights?.clusters.length ?? 0;
  const cycleCount = insights?.cycles.length ?? 0;
  const violationCount = insights?.violations.length ?? 0;
  const prunedCount = insights?.prunedEdges.length ?? 0;
  const inferredErCount = insights?.inferredRelations.length ?? 0;
  const reclassifiedCount = insights?.reclassifiedCount ?? 0;
  const avgConfidence = Math.round((insights?.averageConfidence ?? 0.85) * 100);

  return (
    <div className="border-b border-slate-800/90 bg-slate-900/80 px-3 py-1.5 text-[11px]">
      {/* Primary compact row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Engine Switcher: Algorithm vs Ollama AI Local */}
          <div
            className="inline-flex items-center rounded-lg border border-slate-700/90 bg-slate-950 p-0.5"
            title="Choose how VisualRepo computes the Architecture Map, React Flow roles, 3D clusters, and Database ER relationships"
          >
            <button
              type="button"
              onClick={() => onChangeEngine('algorithm')}
              disabled={loading}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold transition ${
                engine === 'algorithm'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Deterministic PageRank + Tarjan SCC + AST Role Scoring + FK Naming & Join-Table Inference"
            >
              <Cpu className="h-3 w-3" />
              Algorithm
            </button>
            <button
              type="button"
              onClick={() => onChangeEngine('ollama')}
              disabled={loading}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold transition ${
                engine === 'ollama'
                  ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={
                ollamaOnline
                  ? 'Hybrid Local Ollama Structured AI + Graph Algorithm verification'
                  : 'Try Local Ollama AI (automatically falls back to Algorithm if Ollama is offline)'
              }
            >
              <Bot className="h-3 w-3" />
              Ollama AI Local
            </button>
          </div>

          {engine === 'ollama' && availableModels.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => onChangeModel(e.target.value)}
              disabled={loading}
              aria-label="Ollama model for deep analysis"
              className="max-w-[155px] truncate rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-300 transition hover:border-indigo-500/50 hover:text-white disabled:opacity-50"
            title="Re-run deep architecture & ER analysis"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            {loading ? 'Analyzing…' : 'Re-analyze'}
          </button>

          {/* Summary metric pills */}
          {insights && (
            <div className="flex flex-wrap items-center gap-1">
              <span
                className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300"
                title={`Active engine: ${insights.engine} (${insights.modelUsed}) · Average role confidence ${avgConfidence}%`}
              >
                <Sparkles className="h-2.5 w-2.5" />
                {insights.engine === 'ollama' ? `AI (${insights.modelUsed})` : 'Graph Algo'} · {avgConfidence}% conf
              </span>

              {reclassifiedCount > 0 && (
                <span
                  className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300"
                  title={`${reclassifiedCount} file(s) upgraded to more accurate architectural roles`}
                >
                  {reclassifiedCount} refined roles
                </span>
              )}

              {prunedCount > 0 && (
                <span
                  className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300"
                  title={`${prunedCount} false-positive substring dependency edge(s) pruned`}
                >
                  -{prunedCount} false edges
                </span>
              )}

              {inferredErCount > 0 && (
                <button
                  type="button"
                  onClick={onToggleInferredEr}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                    showInferredEr
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-400'
                  }`}
                  title="Toggle AI/Algorithm-inferred foreign-key & join-table relationships on the Database ER diagram"
                >
                  <Wand2 className="h-2.5 w-2.5" />
                  +{inferredErCount} inferred ER links {showInferredEr ? '(on)' : '(off)'}
                </button>
              )}

              {violationCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="inline-flex items-center gap-0.5 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300"
                  title="Architectural layer inversions or bypasses detected — click for details"
                >
                  <ShieldAlert className="h-2.5 w-2.5" />
                  {violationCount} {violationCount === 1 ? 'violation' : 'violations'}
                </button>
              )}

              {cycleCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                  title="Circular dependency cycles detected (Tarjan SCC) — click for details"
                >
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {cycleCount} {cycleCount === 1 ? 'cycle' : 'cycles'}
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:border-indigo-500/50 hover:text-white"
        >
          <Boxes className="h-3 w-3 text-indigo-400" />
          <span>
            Clusters ({clusterCount}) & Diagnostics
          </span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {/* Expandable Deep Insights Drawer */}
      {expanded && insights && (
        <div className="mt-2 space-y-2 rounded-xl border border-slate-800 bg-slate-950/90 p-2.5 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-indigo-300">{insights.architectureStyle}</span>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                {insights.overview}
              </p>
            </div>
          </div>

          {insights.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-200">
              {insights.warnings.join(' · ')}
            </div>
          )}

          {/* Domain Module Clusters filter pills */}
          {insights.clusters.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Domain Module Clusters (click to isolate on Map & 3D)
                </span>
                {activeClusterId !== null && (
                  <button
                    type="button"
                    onClick={() => onSelectCluster(null)}
                    className="text-[10px] text-indigo-300 underline hover:text-white"
                  >
                    Show all clusters
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {insights.clusters.map((c) => {
                  const color = getClusterColor(c.id);
                  const active = activeClusterId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelectCluster(active ? null : c.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold transition hover:brightness-125"
                      style={{
                        borderColor: active ? color : `${color}55`,
                        backgroundColor: active ? `${color}33` : `${color}15`,
                        color: isLightHex(color) ? '#e2e8f0' : '#f8fafc',
                      }}
                      title={`Cohesion: ${Math.round(c.cohesion * 100)}% · Dominant role: ${c.dominantRole}`}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span>{c.name}</span>
                      <span className="rounded bg-slate-900/70 px-1 py-0.2 font-mono text-[9px] text-slate-300">
                        {c.files.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inferred ER Relationships */}
          {insights.inferredRelations.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                Discovered Database ER Relationships ({insights.inferredRelations.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {insights.inferredRelations.map((rel) => (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => onSelectEntityById(rel.source)}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200 hover:border-emerald-400"
                    title={rel.evidence}
                  >
                    <GitMerge className="h-3 w-3 text-emerald-400" />
                    <span className="font-mono font-semibold">
                      {rel.source} → {rel.target}
                    </span>
                    <span className="text-emerald-300/80">
                      ({rel.type} · {Math.round(rel.confidence * 100)}%)
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Layer Violations & Circular Dependencies */}
          {(insights.violations.length > 0 || insights.cycles.length > 0) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {insights.violations.length > 0 && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/25 p-2">
                  <div className="mb-1 font-semibold text-rose-300">
                    Layer Violations ({insights.violations.length})
                  </div>
                  <ul className="space-y-1 text-[10px] text-rose-200">
                    {insights.violations.slice(0, 4).map((v, idx) => (
                      <li key={idx} className="flex items-center justify-between gap-1">
                        <span className="truncate" title={v.reason}>
                          {v.reason}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectFile(v.source)}
                          className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[9px] text-rose-200 hover:bg-rose-500/35"
                        >
                          Inspect
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {insights.cycles.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/25 p-2">
                  <div className="mb-1 font-semibold text-amber-300">
                    Circular Dependencies ({insights.cycles.length})
                  </div>
                  <ul className="space-y-1 text-[10px] text-amber-200">
                    {insights.cycles.slice(0, 4).map((c, idx) => (
                      <li key={idx} className="flex items-center justify-between gap-1">
                        <span className="truncate font-mono">
                          {c.files.map((f) => f.split('/').pop()).join(' ⇄ ')}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectFile(c.files[0])}
                          className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] text-amber-200 hover:bg-amber-500/35"
                        >
                          Inspect
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isLightHex(_hex: string): boolean {
  return false;
}
