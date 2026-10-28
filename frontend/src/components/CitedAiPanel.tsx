import { useState } from 'react';
import {
  MessageSquareCode,
  Send,
  Sparkles,
  History,
  FileCode2,
  Cpu,
  Database,
  Layers,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  Citation,
  CitedAnswerResponse,
  RepositorySummary,
  SystemStatus,
} from '../types/api';
import { PaneHeader, type PaneDragHandlers } from './PaneHeader';

interface CitedAiPanelProps {
  step?: number;
  drag?: PaneDragHandlers;
  currentRepo: RepositorySummary | null;
  systemStatus: SystemStatus | null;
  history: CitedAnswerResponse[];
  asking: boolean;
  buildingEmbeddings: boolean;
  activeCitation: Citation | null;
  onAskQuestion: (question: string, retrievalMode: string, modelOverride?: string) => Promise<void>;
  onBuildEmbeddings: () => Promise<void>;
  onSelectCitation: (citation: Citation) => void;
}

const DEMO_QUESTIONS = [
  'How does submitCheckout validate fraud risk and capture payments?',
  'Where are payment retry limits and transaction thresholds configured?',
  'How does the React frontend communicate with the Spring Boot order controller?',
  'Explain the overall architecture and data flow down to the repository layer.',
];

const GENERIC_QUESTIONS = [
  'Explain the overall architecture and how data flows through it.',
  'What are the main entry points of this project?',
  'Where does the code read from or write to the database?',
  'How do the frontend and backend communicate?',
];

export function CitedAiPanel({
  step = 3,
  drag,
  currentRepo,
  systemStatus,
  history,
  asking,
  buildingEmbeddings,
  activeCitation,
  onAskQuestion,
  onBuildEmbeddings,
  onSelectCitation,
}: CitedAiPanelProps) {
  const [question, setQuestion] = useState('');
  const [retrievalMode, setRetrievalMode] = useState<string>('AUTO');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'ask' | 'history'>('ask');
  const [expandedSnippets, setExpandedSnippets] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const suggestedQuestions =
    currentRepo?.owner === 'demo' && currentRepo?.name === 'order-payment-platform'
      ? DEMO_QUESTIONS
      : GENERIC_QUESTIONS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || asking || !currentRepo) return;
    const q = question.trim();
    setQuestion('');
    await onAskQuestion(
      q,
      retrievalMode === 'AUTO' ? '' : retrievalMode,
      selectedModel || undefined
    );
  };

  const handleSuggestedClick = async (q: string) => {
    if (asking || !currentRepo) return;
    await onAskQuestion(
      q,
      retrievalMode === 'AUTO' ? '' : retrievalMode,
      selectedModel || undefined
    );
  };

  const toggleSnippet = (key: string) => {
    setExpandedSnippets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const latestAnswer = history.length > 0 ? history[0] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-950">
      {/* Header & Tabs */}
      <PaneHeader
        step={step}
        title="Ask the AI"
        subtitle="Answers backed by exact lines (Ollama)"
        icon={MessageSquareCode}
        drag={drag}
        actions={
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px]">
            <button
              onClick={() => setActiveTab('ask')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                activeTab === 'ask'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              Ask
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                activeTab === 'history'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="h-3 w-3" />
              History ({history.length})
            </button>
          </div>
        }
      />

      {/* Search quality & advanced settings */}
      {currentRepo && (
        <div className="border-b border-slate-800 bg-slate-900/40 px-4 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            {currentRepo.embeddingsGenerated ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
                title={`Embedding model: ${currentRepo.embeddingModel}`}
              >
                <CheckCircle2 className="h-3 w-3" />
                Smart search on
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                Basic search
              </span>
            )}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
              aria-expanded={showAdvanced}
            >
              <Layers className="h-3 w-3 text-indigo-400" />
              Settings
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {!currentRepo.embeddingsGenerated && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-2">
              <div className="text-[11px] leading-tight text-slate-300">
                <span className="font-semibold text-indigo-300">Better answers:</span> enable smart search
                (embeddings) so the AI finds related code by meaning, not just keywords.
              </div>
              <button
                onClick={onBuildEmbeddings}
                disabled={buildingEmbeddings}
                className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {buildingEmbeddings ? 'Working…' : 'Enable'}
              </button>
            </div>
          )}

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <div>
                <label className="mb-0.5 block text-[10px] uppercase tracking-wider text-slate-400">
                  Search method
                </label>
                <select
                  value={retrievalMode}
                  onChange={(e) => setRetrievalMode(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="AUTO">
                    Auto ({currentRepo.embeddingsGenerated ? 'smart + keyword' : 'keyword'})
                  </option>
                  <option value="BASIC_INDEX">Keyword only</option>
                  <option value="VECTOR_HYBRID" disabled={!currentRepo.embeddingsGenerated}>
                    Smart (embeddings + keyword)
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-0.5 block text-[10px] uppercase tracking-wider text-slate-400">
                  AI model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">
                    Default ({systemStatus?.configuredChatModel || 'qwen2.5-coder:7b'})
                  </option>
                  {systemStatus?.availableOllamaModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'ask' ? (
          <>
            {/* Suggested Quick Prompts */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Not sure what to ask? Try one of these
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestedQuestions.map((sq) => (
                  <button
                    key={sq}
                    onClick={() => handleSuggestedClick(sq)}
                    disabled={asking || !currentRepo}
                    className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-left text-[11px] text-slate-300 hover:border-indigo-500/40 hover:bg-slate-800/90 hover:text-slate-100 transition disabled:opacity-50"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>

            {asking && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/15 p-4 text-center">
                <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                <p className="mt-2 text-xs font-medium text-indigo-300">
                  Finding the relevant code and writing an answer with citations…
                </p>
              </div>
            )}

            {latestAnswer ? (
              <AnswerCard
                item={latestAnswer}
                activeCitation={activeCitation}
                expandedSnippets={expandedSnippets}
                onToggleSnippet={toggleSnippet}
                onSelectCitation={onSelectCitation}
              />
            ) : (
              !asking && (
                <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-5 text-center text-slate-400">
                  <Sparkles className="mx-auto h-7 w-7 text-indigo-400/70 mb-2" />
                  <p className="text-xs font-medium text-slate-200">
                    Ask anything about this codebase
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                    Each answer points to the exact files and line ranges it is based on (for example{' '}
                    <code className="font-mono text-emerald-300">L12-L48</code>). Click a citation to see
                    those lines in the code panel.
                  </p>
                </div>
              )
            )}
          </>

        ) : (
          <div className="space-y-4">
            {history.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-8">
                No analysis history recorded for this repository yet.
              </p>
            ) : (
              history.map((item) => (
                <AnswerCard
                  key={item.historyId}
                  item={item}
                  activeCitation={activeCitation}
                  expandedSnippets={expandedSnippets}
                  onToggleSnippet={toggleSnippet}
                  onSelectCitation={onSelectCitation}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Question Input Form */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-slate-800 bg-slate-900/80 p-3"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about control flow, rules, or architecture..."
            disabled={asking || !currentRepo}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={asking || !question.trim() || !currentRepo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Ask</span>
          </button>
        </div>
      </form>
    </div>
  );
}

interface AnswerCardProps {
  item: CitedAnswerResponse;
  activeCitation: Citation | null;
  expandedSnippets: Record<string, boolean>;
  onToggleSnippet: (key: string) => void;
  onSelectCitation: (citation: Citation) => void;
}

function AnswerCard({
  item,
  activeCitation,
  expandedSnippets,
  onToggleSnippet,
  onSelectCitation,
}: AnswerCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3 shadow">
      {/* Question & Metadata */}
      <div className="border-b border-slate-800/80 pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400 mb-1">
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-indigo-300">
            <Cpu className="h-3 w-3" />
            {item.modelUsed}
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300 border border-emerald-500/20">
            <Database className="h-3 w-3" />
            {item.retrievalMode}
          </span>
        </div>
        <h4 className="text-xs font-semibold text-slate-100 leading-snug">
          Q: {item.question}
        </h4>
      </div>

      {/* Architectural Summary Banner */}
      {item.architecturalSummary && (
        <div className="rounded-lg border border-indigo-500/25 bg-indigo-950/20 px-3 py-2 text-[11px] text-indigo-200">
          <span className="font-semibold text-indigo-300">Summary: </span>
          {item.architecturalSummary}
        </div>
      )}

      {/* AI Explanation */}
      <div className="whitespace-pre-line text-xs text-slate-200 leading-relaxed">
        {item.answer}
      </div>

      {/* Interactive Verified Citations List */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
          <span>Verified Source Citations ({item.citations.length})</span>
          <span className="text-slate-500 font-normal">Click to inspect lines</span>
        </div>

        {item.citations.map((cit, idx) => {
          const key = `${item.historyId}-${cit.filePath}-${cit.startLine}-${idx}`;
          const isSelected =
            activeCitation?.filePath === cit.filePath &&
            activeCitation?.startLine === cit.startLine &&
            activeCitation?.endLine === cit.endLine;
          const isExpanded = expandedSnippets[key] ?? idx === 0;
          const shortFile = cit.filePath.split('/').pop() || cit.filePath;

          return (
            <div
              key={key}
              className={`rounded-lg border transition-all ${
                isSelected
                  ? 'border-emerald-400 bg-emerald-950/25 ring-1 ring-emerald-400/30'
                  : 'border-slate-800 bg-slate-950/80 hover:border-slate-700'
              }`}
            >
              <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => onSelectCitation(cit)}
                    className="flex items-center gap-1.5 text-left group min-w-0"
                  >
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span className="truncate font-mono text-xs font-semibold text-emerald-300 group-hover:underline">
                      {shortFile}
                    </span>
                    <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-200 border border-emerald-500/30">
                      L{cit.startLine}-L{cit.endLine}
                    </span>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onSelectCitation(cit)}
                      className="rounded bg-indigo-600/80 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-indigo-500 transition"
                    >
                      Inspect
                    </button>
                    {cit.githubBlobUrl && (
                      <a
                        href={cit.githubBlobUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded bg-slate-800 p-1 text-slate-400 hover:text-slate-100"
                        title="Open exact lines on GitHub"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <button
                      onClick={() => onToggleSnippet(key)}
                      className="rounded bg-slate-800 p-1 text-slate-400 hover:text-slate-100"
                      title="Toggle code snippet preview"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
                  {cit.filePath} · Symbol: <span className="text-slate-300">{cit.symbolName}</span>
                </div>

                <p className="mt-1.5 text-[11px] text-slate-300 leading-snug">
                  {cit.reason}
                </p>

                {isExpanded && cit.snippet && (
                  <pre className="mt-2 max-h-36 overflow-auto rounded border border-slate-800 bg-slate-900/90 p-2 font-mono text-[10px] text-slate-300">
                    {cit.snippet
                      .split('\n')
                      .map((line, lIdx) => `${cit.startLine + lIdx}: ${line}`)
                      .join('\n')}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
