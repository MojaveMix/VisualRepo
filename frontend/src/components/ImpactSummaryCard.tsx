import { ArrowLeft, ArrowRight, Code2, ShieldAlert, Zap } from 'lucide-react';
import type { GraphNodeDto } from '../types/api';
import { getRoleMeta } from '../lib/archMeta';
import type { ImpactReport } from '../lib/impactAnalysis';

interface ImpactSummaryCardProps {
  node: GraphNodeDto;
  impact: ImpactReport | null;
  impactMode: boolean;
  graphExpanded: boolean;
  onToggleImpactMode: () => void;
  onSelectFile: (path: string) => void;
  onExitExpanded: () => void;
}

const RISK_BADGE: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  MEDIUM: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  HIGH: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
};

export function ImpactSummaryCard({
  node,
  impact,
  impactMode,
  graphExpanded,
  onToggleImpactMode,
  onSelectFile,
  onExitExpanded,
}: ImpactSummaryCardProps) {
  const role = getRoleMeta(node.architecturalRole);
  const shortName = (p: string) => p.split('/').pop() || p;

  const downstream = impact?.downstream ?? [];
  const upstream = impact?.upstream ?? [];
  const directDown = downstream.filter((d) => d.hops === 1);
  const transitiveDown = downstream.filter((d) => d.hops > 1);

  return (
    <div className="space-y-2 border-t border-slate-800 bg-slate-900/85 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${role.badge}`}
          >
            {role.label}
          </span>
          <span
            className="truncate font-mono text-xs font-semibold text-slate-100"
            title={node.path}
          >
            {node.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {impact && (
            <button
              onClick={onToggleImpactMode}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                impactMode
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-200 shadow-sm'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-amber-500/50 hover:text-white'
              }`}
              title="Highlight every file across all layers that could be affected if an AI agent modifies this file"
            >
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span>Blast Radius ({downstream.length})</span>
              <span
                className={`rounded px-1 py-0.2 text-[9px] font-bold uppercase border ${
                  RISK_BADGE[impact.riskLevel]
                }`}
              >
                {impact.riskLevel}
              </span>
            </button>
          )}

          {graphExpanded && (
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

      {!impactMode ? (
        <>
          <p className="text-[11px] leading-snug text-slate-400">{role.description}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <div className="flex flex-wrap items-center gap-1">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowRight className="h-3 w-3 text-indigo-400" />
                Uses:
              </span>
              {upstream.filter((u) => u.hops === 1).length === 0 ? (
                <span className="text-slate-500">nothing else</span>
              ) : (
                upstream
                  .filter((u) => u.hops === 1)
                  .map((u) => (
                    <button
                      key={u.path}
                      onClick={() => onSelectFile(u.path)}
                      title={u.path}
                      className="rounded border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 transition hover:bg-indigo-500/25"
                    >
                      {u.label}
                    </button>
                  ))
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowLeft className="h-3 w-3 text-emerald-400" />
                Used by:
              </span>
              {directDown.length === 0 ? (
                <span className="text-slate-500">nothing else</span>
              ) : (
                directDown.map((d) => (
                  <button
                    key={d.path}
                    onClick={() => onSelectFile(d.path)}
                    title={d.path}
                    className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 transition hover:bg-emerald-500/25"
                  >
                    {d.label}
                  </button>
                ))
              )}
              {transitiveDown.length > 0 && (
                <button
                  onClick={onToggleImpactMode}
                  className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20"
                >
                  +{transitiveDown.length} indirect →
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-slate-950/90 p-2.5 space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-amber-200">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
              If an AI agent modifies <code className="font-mono text-white">{node.label}</code>:
            </span>
            {impact && (
              <span className="text-[10px] text-slate-400">
                Affects <strong className="text-slate-200">{downstream.length}</strong> files (
                {impact.blastRadiusPercent}% of repo)
                {impact.affectedLayers.length > 0 && (
                  <>
                    {' '}
                    across <strong className="text-slate-200">{impact.affectedLayers.join(' → ')}</strong>
                  </>
                )}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">
                Direct dependents (1 hop):
              </span>
              {directDown.length === 0 ? (
                <span className="text-slate-500">None — no file directly imports this file</span>
              ) : (
                directDown.map((d) => (
                  <button
                    key={d.path}
                    onClick={() => onSelectFile(d.path)}
                    title={`${d.path} (${d.roleLabel})`}
                    className="inline-flex items-center gap-1 rounded border border-rose-500/35 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-200 transition hover:bg-rose-500/25"
                  >
                    <span>{d.label}</span>
                    <span className="text-[9px] text-rose-300/80">({d.roleLabel})</span>
                  </button>
                ))
              )}
            </div>

            {transitiveDown.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Ripple effect (2+ hops):
                </span>
                {transitiveDown.map((d) => (
                  <button
                    key={d.path}
                    onClick={() => onSelectFile(d.path)}
                    title={
                      d.viaPath
                        ? `${d.path} — impacted in ${d.hops} hops via ${shortName(d.viaPath)}`
                        : `${d.path} (${d.hops} hops)`
                    }
                    className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-200 transition hover:bg-amber-500/25"
                  >
                    <span>{d.label}</span>
                    <span className="rounded bg-amber-950/80 px-1 text-[9px] text-amber-300">
                      {d.hops} hops
                    </span>
                  </button>
                ))}
              </div>
            )}

            {upstream.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-0.5 border-t border-slate-800/80">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                  Relies on ({upstream.length}):
                </span>
                {upstream.map((u) => (
                  <button
                    key={u.path}
                    onClick={() => onSelectFile(u.path)}
                    title={`${u.path} (${u.hops} ${u.hops === 1 ? 'hop' : 'hops'})`}
                    className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200 transition hover:bg-cyan-500/20"
                  >
                    <span>{u.label}</span>
                    {u.hops > 1 && <span className="text-[9px] text-cyan-300/80">{u.hops}h</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
