import type { ReactNode } from 'react';

interface PaneHeaderProps {
  step: number;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}

/** Numbered header that guides users through: 1. map → 2. code → 3. AI. */
export function PaneHeader({ step, title, subtitle, actions }: PaneHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-tight text-white">{title}</h2>
          <p className="truncate text-[11px] text-slate-400">{subtitle}</p>
        </div>
      </div>
      {actions}
    </div>
  );
}
