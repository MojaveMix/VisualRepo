import type { NodeProps } from '@xyflow/react';

export interface LaneNodeData extends Record<string, unknown> {
  step?: number;
  title: string;
  subtitle: string;
  color: string;
  count: number;
  roleBadges?: string[];
  width: number;
  height: number;
}

/** Background swimlane band that groups files into an architectural layer. */
export function LaneNode({ data }: NodeProps) {
  const d = data as LaneNodeData;
  return (
    <div
      className="pointer-events-none overflow-hidden rounded-2xl border shadow-sm"
      style={{
        width: d.width,
        height: d.height,
        backgroundColor: `${d.color}0d`,
        borderColor: `${d.color}4d`,
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5"
        style={{
          backgroundColor: `${d.color}16`,
          borderColor: `${d.color}38`,
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {typeof d.step === 'number' && (
            <span
              className="flex h-5 shrink-0 items-center justify-center rounded-md px-1.5 font-mono text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${d.color}28`,
                color: d.color,
                border: `1px solid ${d.color}55`,
              }}
            >
              Layer {d.step}
            </span>
          )}
          <span className="text-sm font-bold tracking-tight" style={{ color: d.color }}>
            {d.title}
          </span>
          <span className="truncate text-[11px] text-slate-400">{d.subtitle}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {d.roleBadges &&
            d.roleBadges.map((badge) => (
              <span
                key={badge}
                className="hidden rounded-md border border-slate-700/70 bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-slate-300 sm:inline-block"
              >
                {badge}
              </span>
            ))}
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
            style={{ backgroundColor: `${d.color}24`, color: d.color }}
          >
            {d.count} {d.count === 1 ? 'file' : 'files'}
          </span>
        </div>
      </div>
    </div>
  );
}
