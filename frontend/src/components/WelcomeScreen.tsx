import { GitBranch, Network, FileCode2, MessageSquareCode } from 'lucide-react';
import { IndexRepoForm } from './IndexRepoForm';

interface WelcomeScreenProps {
  onSubmit: (repo: string, branch?: string) => Promise<void>;
  indexing: boolean;
  error: string | null;
  githubTokenConfigured?: boolean;
}

const STEPS = [
  {
    icon: Network,
    title: 'See the architecture',
    text: 'Files are grouped into layers, from the frontend down to the data models, with arrows showing who uses whom.',
  },
  {
    icon: FileCode2,
    title: 'Read the real code',
    text: 'Click any file to inspect its source, functions and dependencies.',
  },
  {
    icon: MessageSquareCode,
    title: 'Ask the AI, with proof',
    text: 'Every answer cites exact files and line ranges you can click to verify.',
  },
];

export function WelcomeScreen({ onSubmit, indexing, error, githubTokenConfigured }: WelcomeScreenProps) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-600/20">
            <GitBranch className="h-6 w-6 text-indigo-300" />
          </div>
          <h1 className="bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
            Understand any codebase in minutes
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">
            Paste a GitHub repository to get an interactive architecture map and an AI assistant that
            backs every answer with the exact lines of code.
          </p>
        </div>

        <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl">
          <IndexRepoForm
            onSubmit={onSubmit}
            indexing={indexing}
            error={error}
            githubTokenConfigured={githubTokenConfigured}
            autoFocus
          />
        </div>

        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600/25 text-[11px] font-bold text-indigo-300">
                  {i + 1}
                </span>
                <s.icon className="h-4 w-4 text-slate-400" />
              </div>
              <h3 className="text-xs font-semibold text-slate-100">{s.title}</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
