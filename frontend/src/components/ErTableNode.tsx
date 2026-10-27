import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2, Table2 } from 'lucide-react';
import type { ErColumn, ErEntity } from '../types/api';
import { ER_HEADER_HEIGHT, ER_NODE_WIDTH, ER_ROW_HEIGHT } from '../lib/erLayout';

export interface ErTableNodeData extends Record<string, unknown> {
  entity: ErEntity;
  isSelected: boolean;
  isDimmed: boolean;
  highlightedColumn: string | null;
  onSelectColumn: (entity: ErEntity, column: ErColumn) => void;
}

const SIDES: { side: string; position: Position }[] = [
  { side: 'top', position: Position.Top },
  { side: 'bottom', position: Position.Bottom },
  { side: 'left', position: Position.Left },
  { side: 'right', position: Position.Right },
];

/** A database table drawn like in a classic ER diagram: header + one row per column. */
export function ErTableNode({ data }: NodeProps) {
  const d = data as ErTableNodeData;
  const { entity } = d;

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-slate-900 shadow-lg transition-all duration-200 ${
        d.isSelected
          ? 'border-indigo-400 ring-2 ring-indigo-400/40 shadow-indigo-500/25'
          : 'border-slate-700 hover:border-slate-500'
      } ${d.isDimmed ? 'opacity-35 saturate-50' : 'opacity-100'}`}
      style={{ width: ER_NODE_WIDTH }}
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

      <div
        className="flex cursor-pointer items-center gap-2 border-b border-slate-700 bg-gradient-to-r from-indigo-600/30 to-cyan-600/20 px-3"
        style={{ height: ER_HEADER_HEIGHT }}
        title={`${entity.className} · ${entity.filePath}`}
      >
        <Table2 className="h-4 w-4 shrink-0 text-indigo-300" />
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-bold leading-tight text-white">
            {entity.tableName}
          </div>
          <div className="truncate text-[10px] leading-tight text-slate-400">
            class {entity.className}
          </div>
        </div>
      </div>

      <ul>
        {entity.columns.map((col) => {
          const isHighlighted = d.highlightedColumn === col.name;
          return (
            <li
              key={col.name}
              onClick={(e) => {
                e.stopPropagation();
                d.onSelectColumn(entity, col);
              }}
              style={{ height: ER_ROW_HEIGHT }}
              className={`flex cursor-pointer items-center gap-2 border-b border-slate-800/70 px-3 text-[12px] last:border-b-0 ${
                isHighlighted ? 'bg-emerald-500/15' : 'hover:bg-slate-800/80'
              }`}
              title={[
                `${col.name}: ${col.sqlType}`,
                col.primaryKey ? 'primary key' : null,
                col.foreignKey && col.references ? `foreign key → ${col.references}` : null,
                col.unique ? 'unique' : null,
                col.nullable ? 'nullable' : 'required (NOT NULL)',
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {col.primaryKey ? (
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                ) : col.foreignKey ? (
                  <Link2 className="h-3.5 w-3.5 text-indigo-300" />
                ) : null}
              </span>
              <span
                className={`min-w-0 flex-1 truncate font-mono ${
                  col.primaryKey ? 'font-semibold text-white' : 'text-slate-200'
                }`}
              >
                {col.name}
              </span>
              <span
                className={`shrink-0 font-mono text-[10px] ${
                  col.nullable ? 'text-slate-500' : 'text-slate-300'
                }`}
              >
                {col.sqlType}
                {!col.nullable && !col.primaryKey && <span className="ml-1 text-rose-300">*</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
