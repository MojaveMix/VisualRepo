import { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import type { RepositorySummary } from '../types/api';
import { IndexRepoForm } from './IndexRepoForm';

interface IndexRepoDialogProps {
  open: boolean;
  repos: RepositorySummary[];
  currentRepoId?: number;
  indexing: boolean;
  error: string | null;
  githubTokenConfigured?: boolean;
  onClose: () => void;
  onSubmit: (repo: string, branch?: string) => Promise<void>;
  onSelectRepo: (repoId: number) => void;
}

export function IndexRepoDialog({
  open,
  repos,
  currentRepoId,
  indexing,
  error,
  githubTokenConfigured,
  onClose,
  onSubmit,
  onSelectRepo,
}: IndexRepoDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !indexing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, indexing, onClose]);

  if (!open) return null;

  return (
    <div
      className="vr-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !indexing) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Analyze a GitHub repository"
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100">Analyze a repository</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Paste a public GitHub repository. VisualRepo reads its files and draws the architecture map.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={indexing}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <IndexRepoForm
          onSubmit={onSubmit}
          indexing={indexing}
          error={error}
          githubTokenConfigured={githubTokenConfigured}
          autoFocus
        />

        {repos.length > 0 && (
          <div className="mt-5 border-t border-slate-800 pt-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Already analyzed
            </h3>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {repos.map((r) => (
                <li key={r.id}>
                  <button
                    disabled={indexing}
                    onClick={() => {
                      onSelectRepo(r.id);
                      onClose();
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition disabled:opacity-50 ${
                      r.id === currentRepoId
                        ? 'border-indigo-500/50 bg-indigo-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-100">
                        {r.owner}/{r.name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {r.fileCount} files · {r.edgeCount} connections
                      </span>
                    </span>
                    {r.id === currentRepoId && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-indigo-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Open
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
