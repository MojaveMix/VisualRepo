import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArrowRight, MousePointerClick, Sparkles, Crosshair } from 'lucide-react';

export interface LayerSummaryNodeData extends Record<string, unknown> {
  step: number;
  title: string;
  subtitle: string;
  color: string;
  count: number;
  roleBadges: string[];
  topFiles: { id: string; label: string }[];
  internalLinks: number;
  /** Layers this layer depends on (flow goes down to them). */
  usesLayers: { title: string; count: number }[];
  citedCount: number;
  containsSelected: boolean;
  selectedLabel?: string;
  width: number;
  height: number;
}

const SIDES: { side: string; position: Position }[] = [
  { side: 'top', position: Position.Top },
  { side: 'bottom', position: Position.Bottom },
  { side: 'left', position: Position.Left },
  { side: 'right', position: Position.Right },
];

/** One collapsed architectural layer on the big-picture map. Click to open its files. */
export function LayerSummaryNode({ data }: NodeProps) {
  const d = data as LayerSummaryNodeData;
  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-slate-900 shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl ${
        d.containsSelected ? 'ring-2 ring-indigo-400/50' : ''
      }`}
      style={{
        width: d.width,
        height: d.height,
        borderColor: `${d.color}${d.containsSelected ? 'cc' : '66'}`,
        backgroundImage: `linear-gradient(135deg, ${d.color}1f, transparent 60%)`,
      }}
      title={`Click to open the ${d.count} ${d.count === 1 ? 'file' : 'files'} in ${d.title}`}
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

      <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: d.color }} />

      <div className="flex h-full flex-col justify-between py-3.5 pl-5 pr-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: `${d.color}28`,
                  color: d.color,
                  border: `1px solid ${d.color}55`,
                }}
              >
                Step {d.step}
              </span>
              <span className="truncate text-base font-bold tracking-tight" style={{ color: d.color }}>
                {d.title}
              </span>
            </div>
            <p className="mt-1 truncate text-[12px] text-slate-400">{d.subtitle}</p>
          </div>
          <span
            className="shrink-0 rounded-full px-3 py-1 text-xs font-bold"
            style={{ backgroundColor: `${d.color}24`, color: d.color }}
          >
            {d.count} {d.count === 1 ? 'file' : 'files'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {d.topFiles.map((f) => (
            <span
              key={f.id}
              className="max-w-[150px] truncate rounded-md border border-slate-700/80 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
              title={f.id}
            >
              {f.label}
            </span>
          ))}
          {d.count > d.topFiles.length && (
            <span className="text-[10px] font-medium text-slate-500">
              +{d.count - d.topFiles.length} more
            </span>
          )}
        </div>

        <div className="flex items-end justify-between gap-3 text-[11px]">
          <div className="flex min-w-0 flex-col gap-1 text-slate-400">
            {d.usesLayers.length > 0 ? (
              <span className="flex min-w-0 items-center gap-1">
                <ArrowRight className="h-3 w-3 shrink-0" style={{ color: d.color }} />
                <span className="truncate">
                  Uses{' '}
                  {d.usesLayers.map((u, i) => (
                    <Fragment key={u.title}>
                      {i > 0 && ', '}
                      <span className="font-semibold text-slate-200">{u.title}</span>
                    </Fragment>
                  ))}
                </span>
              </span>
            ) : (
              <span className="text-slate-500">Does not depend on other layers</span>
            )}
            <span className="flex items-center gap-2 text-[10px] text-slate-500">
              {d.internalLinks > 0 && <span>{d.internalLinks} links inside this layer</span>}
              {d.citedCount > 0 && (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                  <Sparkles className="h-3 w-3" />
                  {d.citedCount} cited by AI
                </span>
              )}
              {d.containsSelected && (
                <span className="inline-flex max-w-[180px] items-center gap-1 truncate font-semibold text-indigo-300">
                  <Crosshair className="h-3 w-3 shrink-0" />
                  <span className="truncate">{d.selectedLabel}</span>
                </span>
              )}
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-slate-300 transition group-hover:border-indigo-400/70 group-hover:text-indigo-200">
            <MousePointerClick className="h-3 w-3" />
            Open files
          </span>
        </div>
      </div>
    </div>
  );
}
