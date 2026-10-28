import type { DragEvent, ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  PictureInPicture2,
  type LucideIcon,
} from 'lucide-react';

export type PaneId = 'map' | 'code' | 'ai';

export interface PaneDragHandlers {
  paneId: PaneId;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  canDockSide?: boolean;
  isDragging?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onDockSide?: () => void;
  onDragStart?: (e: DragEvent<HTMLElement>, paneId: PaneId) => void;
  onDragEnd?: (e: DragEvent<HTMLElement>) => void;
}

interface PaneHeaderProps {
  step: number;
  title: string;
  subtitle: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  drag?: PaneDragHandlers;
}

/**
 * Draggable editor-style header for the 3 workspace panes:
 * Architecture & Impact, Source code, and Ask the AI.
 */
export function PaneHeader({
  step,
  title,
  subtitle,
  icon: Icon,
  actions,
  drag,
}: PaneHeaderProps) {
  const handleDragStart = (e: DragEvent<HTMLElement>) => {
    if (!drag?.onDragStart) return;
    // Prevent starting a pane drag if the user interacted with a button/input inside actions
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, select, a')) {
      e.preventDefault();
      return;
    }
    drag.onDragStart(e, drag.paneId);
  };

  return (
    <div
      draggable={Boolean(drag?.onDragStart)}
      onDragStart={handleDragStart}
      onDragEnd={drag?.onDragEnd}
      className={`group/header flex select-none items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/85 px-3 py-2.5 transition-colors ${
        drag?.onDragStart ? 'cursor-grab active:cursor-grabbing hover:bg-slate-900' : ''
      } ${drag?.isDragging ? 'bg-indigo-950/40' : ''}`}
      title={drag?.onDragStart ? 'Drag header to reorder panel in workspace' : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        {drag?.onDragStart && (
          <span
            className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-slate-500 transition group-hover/header:bg-slate-800 group-hover/header:text-indigo-400"
            title="Drag to move this panel"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="vr-step-badge flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white shadow-sm">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight text-slate-100">
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-indigo-400" />}
            <span className="truncate">{title}</span>
          </h2>
          <p className="truncate text-[11px] text-slate-400">{subtitle}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {drag && (drag.canMoveLeft || drag.canMoveRight || drag.canDockSide) && (
          <div className="hidden items-center gap-0.5 rounded-md border border-slate-800 bg-slate-950/80 p-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 xl:flex">
            <button
              type="button"
              disabled={!drag.canMoveLeft}
              onClick={drag.onMoveLeft}
              className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-25"
              title="Move panel left"
              aria-label={`Move ${title} panel left`}
            >
              <ArrowLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              disabled={!drag.canMoveRight}
              onClick={drag.onMoveRight}
              className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-25"
              title="Move panel right"
              aria-label={`Move ${title} panel right`}
            >
              <ArrowRight className="h-3 w-3" />
            </button>
            {drag.canDockSide && drag.onDockSide && (
              <button
                type="button"
                onClick={drag.onDockSide}
                className="rounded p-1 text-indigo-400 transition hover:bg-slate-800 hover:text-slate-100"
                title="Detach into floating Side Box (or drag panel to left/right edge)"
                aria-label={`Dock ${title} into side box`}
              >
                <PictureInPicture2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        {actions}
      </div>
    </div>
  );
}
