import { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Github, Loader2, Search } from 'lucide-react';
import { EXAMPLE_REPOS, isValidRepoInput } from '../lib/repoInput';

interface IndexRepoFormProps {
  onSubmit: (repo: string, branch?: string) => Promise<void>;
  indexing: boolean;
  error: string | null;
  githubTokenConfigured?: boolean;
  autoFocus?: boolean;
}

const PROGRESS_MESSAGES = [
  'Fetching the repository from GitHub…',
  'Reading files and detecting languages…',
  'Extracting classes, functions and imports…',
  'Building the dependency graph…',
];

export function IndexRepoForm({
  onSubmit,
  indexing,
  error,
  githubTokenConfigured,
  autoFocus,
}: IndexRepoFormProps) {
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [touched, setTouched] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);

  useEffect(() => {
    if (!indexing) {
      setProgressIdx(0);
      return;
    }
    const timer = setInterval(() => {
      setProgressIdx((i) => Math.min(i + 1, PROGRESS_MESSAGES.length - 1));
    }, 2500);
    return () => clearInterval(timer);
  }, [indexing]);

  const valid = isValidRepoInput(repo);
  const showInvalid = touched && repo.trim().length > 0 && !valid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || indexing) return;
    await onSubmit(repo.trim(), branch.trim() || undefined);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor="repo-input" className="mb-1.5 block text-xs font-semibold text-slate-200">
          GitHub repository
        </label>
        <div className="relative">
          <Github className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            id="repo-input"
            type="text"
            autoFocus={autoFocus}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={indexing}
            placeholder="owner/repo  or  https://github.com/owner/repo"
            className={`w-full rounded-xl border bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 disabled:opacity-60 ${
              showInvalid
                ? 'border-rose-500/60 focus:ring-rose-500/30'
                : 'border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/30'
            }`}
          />
        </div>
        {showInvalid && (
          <p className="mt-1 text-[11px] text-rose-300">
            Use the format <code className="font-mono">owner/repo</code> (for example{' '}
            <code className="font-mono">spring-projects/spring-petclinic</code>).
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-slate-400">Try an example:</span>
        {EXAMPLE_REPOS.map((ex) => (
          <button
            key={ex.value}
            type="button"
            disabled={indexing}
            onClick={() => {
              setRepo(ex.value);
              setTouched(true);
            }}
            className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 transition hover:border-indigo-500/60 hover:text-white disabled:opacity-50"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
        >
          {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Advanced options
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <label htmlFor="branch-input" className="mb-1 block text-[11px] text-slate-400">
              Branch (leave empty to use the default branch)
            </label>
            <input
              id="branch-input"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={indexing}
              placeholder="main"
              className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            />
          </div>
        )}
      </div>

      {githubTokenConfigured === false && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          Tip: no <code className="font-mono">GITHUB_TOKEN</code> is configured, so GitHub limits you to 60
          requests per hour. Large repositories may fail until you set one.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={indexing || !repo.trim()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:from-indigo-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {indexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {indexing ? 'Analyzing…' : 'Analyze repository'}
      </button>

      {indexing && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" />
          </div>
          <p className="text-[11px] text-slate-400">{PROGRESS_MESSAGES[progressIdx]}</p>
        </div>
      )}
    </form>
  );
}
