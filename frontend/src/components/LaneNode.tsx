import type { NodeProps } from '@xyflow/react';

export interface LaneNodeData extends Record<string, unknown> {
  title: string;
  subtitle: string;
  color: string;
  count: number;
  width: number;
  height: number;
}

/** Background band that groups files into an architecture layer. */
export function LaneNode({ data }: NodeProps) {
  const d = data as LaneNodeData;
  return (
    <div
      className="pointer-events-none rounded-2xl border border-dashed"
      style={{
        width: d.width,
        height: d.height,
        backgroundColor: `${d.color}10`,
        borderColor: `${d.color}55`,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 px-4 pt-3">
        <span className="text-sm font-bold tracking-tight" style={{ color: d.color }}>
          {d.title}
        </span>
        <span className="text-[11px] text-slate-400">{d.subtitle}</span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: `${d.color}22`, color: d.color }}
        >
          {d.count} {d.count === 1 ? 'file' : 'files'}
        </span>
      </div>
    </div>
  );
}
