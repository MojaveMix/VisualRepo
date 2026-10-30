import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, ArrowDown, ArrowUp, Zap, AlertTriangle, Flag, Users } from 'lucide-react';
import { describeFile, getRoleMeta, refineArchitecturalRole, type FileBadge } from '../lib/archMeta';

export interface ArchNodeData extends Record<string, unknown> {
  path: string;
  label: string;
  directory: string;
  language: string;
  architecturalRole: string;
  tier: string;
  lineCount: number;
  symbols: string[];
  incomingCount: number;
  outgoingCount: number;
  isSelected: boolean;
  isCited: boolean;
  isDimmed: boolean;
  citationLines?: string;
  impactKind?: 'downstream' | 'upstream' | null;
  impactHops?: number;
  deepSummary?: string;
  confidence?: number;
  importance?: number;
  clusterName?: string;
  clusterColor?: string;
  inCycle?: boolean;
  reasons?: string[];
}

const SIDES: { side: string; position: Position }[] = [
  { side: 'top', position: Position.Top },
  { side: 'bottom', position: Position.Bottom },
  { side: 'left', position: Position.Left },
  { side: 'right', position: Position.Right },
];

const BADGE_STYLE: Record<FileBadge['tone'], string> = {
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  warn: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
};

const MAX_SYMBOLS = 3;

export function ArchitectureNode({ data }: NodeProps) {
  const d = data as ArchNodeData;
  const effectiveRole = refineArchitecturalRole(d.path, d.architecturalRole, d.language);
  const role = getRoleMeta(effectiveRole);
  const Icon = role.icon;
  const insight = describeFile(d);

  const symbols = [...new Set(d.symbols ?? [])];
  const shownSymbols = symbols.slice(0, MAX_SYMBOLS);
  const hiddenSymbols = symbols.length - shownSymbols.length;

  const ring = d.isCited
    ? 'border-emerald-400 ring-2 ring-emerald-400/40 shadow-emerald-500/20'
    : d.isSelected
    ? 'border-indigo-400 ring-2 ring-indigo-400/40 shadow-indigo-500/25'
    : d.impactKind === 'downstream'
    ? d.impactHops === 1
      ? 'border-rose-400/80 ring-2 ring-rose-400/30 shadow-rose-500/15'
      : 'border-amber-400/80 ring-1 ring-amber-400/30 shadow-amber-500/10'
    : d.impactKind === 'upstream'
    ? 'border-cyan-400/70 ring-1 ring-cyan-400/25'
    : `${role.border} hover:border-slate-400`;

  const ribbon =
    d.impactKind === 'downstream' && d.impactHops ? (
      <span
        className={`absolute -top-2.5 right-2 z-10 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold shadow ${
          d.impactHops === 1
            ? 'border-rose-500/50 bg-rose-950 text-rose-200'
            : 'border-amber-500/50 bg-amber-950 text-amber-200'
        }`}
      >
        <Zap className="h-2.5 w-2.5" />
        {d.impactHops === 1 ? 'Breaks first' : `Ripple · ${d.impactHops} hops`}
      </span>
    ) : d.impactKind === 'upstream' && d.impactHops ? (
      <span className="absolute -top-2.5 right-2 z-10 inline-flex items-center gap-1 rounded-full border border-cyan-500/50 bg-cyan-950 px-2 py-0.5 text-[9px] font-bold text-cyan-200 shadow">
        Needed by selection · {d.impactHops}h
      </span>
    ) : d.isCited ? (
      <span className="absolute -top-2.5 right-2 z-10 inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-950 px-2 py-0.5 text-[9px] font-bold text-emerald-200 shadow">
        <Sparkles className="h-2.5 w-2.5" />
        Cited by AI{d.citationLines ? ` · ${d.citationLines}` : ''}
      </span>
    ) : d.inCycle ? (
      <span
        className="absolute -top-2.5 right-2 z-10 inline-flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-950 px-2 py-0.5 text-[9px] font-bold text-rose-200 shadow"
        title="Part of a circular dependency cycle (Tarjan SCC)"
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        Circular cycle
      </span>
    ) : (d.importance ?? 0) >= 0.82 ? (
      <span
        className="absolute -top-2.5 right-2 z-10 inline-flex items-center gap-1 rounded-full border border-indigo-500/50 bg-indigo-950 px-2 py-0.5 text-[9px] font-bold text-indigo-200 shadow"
        title={`Core architectural hub (PageRank centrality ${Math.round((d.importance ?? 0) * 100)}%)`}
      >
        ★ Core Hub
      </span>
    ) : null;

  const purposeText = d.deepSummary || insight.purpose;
  const reasonLine = d.reasons && d.reasons.length > 0 ? `\nWhy: ${d.reasons.join(' · ')}` : '';
  const clusterLine = d.clusterName ? `\nCluster: ${d.clusterName}` : '';
  const tooltip = `${d.path}\n${d.language} · ${d.lineCount} lines${clusterLine}\n${purposeText}${reasonLine}`;

  return (
    <div
      className={`relative h-[168px] w-[236px] cursor-pointer rounded-xl border bg-slate-900 p-3 shadow-lg transition-all duration-200 ${ring} ${
        d.isDimmed ? 'opacity-35 saturate-50' : 'opacity-100'
      }`}
      title={tooltip}
    >
      {SIDES.map(({ side, position }) => (
        <Fragment key={side}>
          <Handle
            id={`${side}-target`}
            type="target"
            position={position}
            className="!h-2 !w-2 !border-2 !border-slate-900 !bg-slate-400"
          />
          <Handle
            id={`${side}-source`}
            type="source"
            position={position}
            className="!h-2 !w-2 !border-2 !border-slate-900 !bg-slate-400"
          />
        </Fragment>
      ))}

      {ribbon}

      <div className={`absolute inset-x-0 top-0 h-1 rounded-t-xl ${role.accent}`} />

      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${role.iconBox}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-slate-100">{d.label}</div>
          <div className="flex items-center gap-1 truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {d.clusterColor && (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: d.clusterColor }}
                title={d.clusterName}
              />
            )}
            <span className="truncate">{role.label}</span>
            <span className="text-slate-600">·</span>
            <span className="shrink-0 normal-case tracking-normal text-slate-500">{d.lineCount} lines</span>
          </div>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 h-[30px] text-[11px] leading-[15px] text-slate-300">
        {purposeText}
      </p>

      <div className="mt-1.5 flex h-[18px] items-center gap-1 overflow-hidden">
        {shownSymbols.length === 0 ? (
          <span className="text-[10px] italic text-slate-600">No named functions found</span>
        ) : (
          <>
            {shownSymbols.map((s) => (
              <span
                key={s}
                className="max-w-[72px] truncate rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-300"
                title={s}
              >
                {s}
              </span>
            ))}
            {hiddenSymbols > 0 && (
              <span className="shrink-0 text-[9px] font-medium text-slate-500">+{hiddenSymbols}</span>
            )}
          </>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px] text-slate-500">
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {insight.badges.slice(0, 2).map((b) => (
            <span
              key={b.text}
              title={b.hint}
              className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded border px-1 py-0.5 text-[9px] font-semibold ${BADGE_STYLE[b.tone]}`}
            >
              {b.tone === 'warn' ? (
                <AlertTriangle className="h-2.5 w-2.5" />
              ) : b.tone === 'good' ? (
                <Flag className="h-2.5 w-2.5" />
              ) : (
                <Users className="h-2.5 w-2.5" />
              )}
              {b.text}
            </span>
          ))}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-0.5" title="Uses (flows down to) this many files">
            <ArrowDown className="h-3 w-3 text-indigo-400" />
            {d.outgoingCount}
          </span>
          <span className="flex items-center gap-0.5" title="Used by (flows in from) this many files">
            <ArrowUp className="h-3 w-3 text-emerald-400" />
            {d.incomingCount}
          </span>
        </span>
      </div>
    </div>
  );
}
