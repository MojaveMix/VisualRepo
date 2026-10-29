import { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { LAYERS } from '../lib/archMeta';

const STORAGE_KEY = 'visualrepo.legend.seen';

function initiallyOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Floating "How to read this map" help card shown on top of the architecture graph. */
export function MapLegend({ mode = 'detail' }: { mode?: 'overview' | 'detail' }) {
  const [open, setOpen] = useState(initiallyOpen);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore storage errors
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-[11px] font-medium text-slate-200 shadow-lg transition hover:border-indigo-500/60 hover:text-slate-100"
      >
        <HelpCircle className="h-3.5 w-3.5 text-indigo-300" />
        How to read this map
      </button>
    );
  }

  return (
    <div className="absolute right-3 top-3 z-20 w-72 rounded-xl border border-slate-700 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
          <HelpCircle className="h-3.5 w-3.5 text-indigo-300" />
          How to read this map
        </h3>
        <button
          onClick={close}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Close help"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {mode === 'overview' ? (
        <ul className="space-y-1.5 text-[11px] leading-snug text-slate-300">
          <li>
            <span className="font-semibold text-slate-100">Each card is a layer</span> of the app, from
            what users see (top) down to the data (bottom).
          </li>
          <li>
            <span className="font-semibold text-slate-100">Arrows</span> point from the layer that{' '}
            <em>uses</em> code to the layer it <em>depends on</em>. The number is how many file-to-file
            links were merged into it.
          </li>
          <li>
            <span className="font-semibold text-slate-100">Click a layer</span> to open its files, or pick
            “All files” above.
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-pink-500" />
            <span>
              <span className="font-semibold text-pink-300">Pink dashed</span>: frontend calling a backend API
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span>
              <span className="font-semibold text-emerald-300">Cited by AI</span>: files the latest answer used
            </span>
          </li>
        </ul>
      ) : (
        <ul className="space-y-1.5 text-[11px] leading-snug text-slate-300">
          <li>
            <span className="font-semibold text-slate-100">Layers (top to bottom):</span> from what users see
            down to the data. Requests usually flow downward.
          </li>
          <li>
            <span className="font-semibold text-slate-100">Cards</span> are files. Each shows what it is
            for (guessed from its name and place), its main functions, and review flags. Click one to read its
            code and highlight its connections.
          </li>
          <li>
            <span className="font-semibold text-amber-300">Not used yet</span> /{' '}
            <span className="font-semibold text-amber-300">Large file</span>: possible dead or bloated
            generated code worth a closer look.
          </li>
          <li>
            <span className="font-semibold text-sky-300">Shared by N</span>: many files depend on it, so
            changes ripple widely.
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 bg-indigo-400" />
            <span>
              <span className="font-semibold text-indigo-300">Indigo</span> arrow: the selected file uses it
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 bg-emerald-400" />
            <span>
              <span className="font-semibold text-emerald-300">Green</span> arrow: it uses the selected file
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-pink-500" />
            <span>
              <span className="font-semibold text-pink-300">Pink dashed</span>: frontend calling a backend API
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span>
              <span className="font-semibold text-emerald-300">Green glow</span>: cited by the AI answer
            </span>
          </li>
        </ul>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1 border-t border-slate-800 pt-2.5">
        {LAYERS.slice(0, 6).map((l) => (
          <span
            key={l.key}
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: `${l.color}22`, color: l.color }}
          >
            {l.title}
          </span>
        ))}
      </div>
    </div>
  );
}
