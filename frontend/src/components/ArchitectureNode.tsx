import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, ArrowDown, ArrowUp, Zap } from 'lucide-react';
import { getRoleMeta, refineArchitecturalRole } from '../lib/archMeta';

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
}

const SIDES: { side: string; position: Position }[] = [
  { side: 'top', position: Position.Top },
  { side: 'bottom', position: Position.Bottom },
  { side: 'left', position: Position.Left },
  { side: 'right', position: Position.Right },
];

export function ArchitectureNode({ data }: NodeProps) {
  const d = data as ArchNodeData;
  const effectiveRole = refineArchitecturalRole(d.path, d.architecturalRole, d.language);
  const role = getRoleMeta(effectiveRole);
  const Icon = role.icon;

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

  return (
    <div
      className={`relative w-[236px] cursor-pointer rounded-xl border bg-slate-900 p-3 shadow-lg transition-all duration-200 ${ring} ${
        d.isDimmed ? 'opacity-35 saturate-50' : 'opacity-100'
      }`}
      title={d.path}
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

      <div className={`absolute inset-x-0 top-0 h-1 rounded-t-xl ${role.accent}`} />

      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${role.iconBox}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-slate-100">{d.label}</div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <span className="truncate">{role.label}</span>
          </div>
        </div>
      </div>

      <p className="mt-1.5 truncate font-mono text-[10px] text-slate-400" title={d.directory}>
        {d.directory === '/' ? d.path : d.directory}
      </p>

      {d.impactKind === 'downstream' && d.impactHops && (
        <div
          className={`mt-2 flex items-center justify-between rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
            d.impactHops === 1
              ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
              : 'border-amber-500/40 bg-amber-500/15 text-amber-200'
          }`}
        >
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {d.impactHops === 1 ? 'Direct impact' : 'Transitive impact'}
          </span>
          <span className="font-mono">
            {d.impactHops} {d.impactHops === 1 ? 'hop' : 'hops'}
          </span>
        </div>
      )}

      {d.impactKind === 'upstream' && d.impactHops && (
        <div className="mt-2 flex items-center justify-between rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
          <span>Used by selection</span>
          <span className="font-mono">
            {d.impactHops} {d.impactHops === 1 ? 'hop' : 'hops'}
          </span>
        </div>
      )}

      {d.isCited ? (
        <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-300">
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            Cited by AI
          </span>
          {d.citationLines && <span className="font-mono">{d.citationLines}</span>}
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-400">
            {d.language} · {d.lineCount} lines
          </span>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-0.5" title="Files this file depends on">
              <ArrowUp className="h-3 w-3 text-indigo-400" />
              {d.outgoingCount}
            </span>
            <span className="flex items-center gap-0.5" title="Files that depend on this file">
              <ArrowDown className="h-3 w-3 text-emerald-400" />
              {d.incomingCount}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
