import { useEffect, useRef, useState } from 'react';
import {
  FileCode,
  ExternalLink,
  Code2,
  GitCommit,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import type { Citation, SourceFileDetail, SymbolInfo } from '../types/api';
import { getRoleMeta, refineArchitecturalRole } from '../lib/archMeta';
import { getEditorBackground, highlightCode, type HighlightedFile } from '../lib/highlight';
import { useTheme } from '../lib/theme';

interface EvidenceInspectorProps {
  fileDetail: SourceFileDetail | null;
  loading: boolean;
  activeCitation: Citation | null;
  highlightedRange: { startLine: number; endLine: number; label?: string; reason?: string } | null;
  onSelectRange: (startLine: number, endLine: number, label?: string, reason?: string) => void;
  onNavigateToFile: (filePath: string) => void;
}

export function EvidenceInspector({
  fileDetail,
  loading,
  activeCitation,
  highlightedRange,
  onSelectRange,
  onNavigateToFile,
}: EvidenceInspectorProps) {
  const { theme, isDark } = useTheme();
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState<{
    path: string;
    theme: string;
    data: HighlightedFile;
  } | null>(null);

  // Tokenize the file with the active VS Code Dark+ / Light+ theme (async: grammars load on demand)
  useEffect(() => {
    if (!fileDetail) return;
    let cancelled = false;
    const { path, content } = fileDetail;
    highlightCode(content, path, theme)
      .then((data) => {
        if (!cancelled && data) setHighlighted({ path, theme, data });
      })
      .catch(() => {
        // fall back to plain text if highlighting fails
      });
    return () => {
      cancelled = true;
    };
  }, [fileDetail, theme]);

  useEffect(() => {
    if (highlightedRange && targetLineRef.current) {
      targetLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [fileDetail?.path, highlightedRange?.startLine, highlightedRange?.endLine, highlighted]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        <p className="mt-3 text-xs">Loading source file & extracted language symbols...</p>
      </div>
    );
  }

  if (!fileDetail) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500">
        <FileCode className="h-10 w-10 text-slate-700 mb-3" />
        <p className="text-sm font-medium text-slate-300">No file selected</p>
        <p className="mt-1 max-w-xs text-xs text-slate-500">
          Click a file on the architecture map, pick one from the file list, or click an AI citation to read the exact lines here.
        </p>
      </div>
    );
  }

  const lines = fileDetail.content.split('\n');
  const tokenLines =
    highlighted && highlighted.path === fileDetail.path && highlighted.theme === theme
      ? highlighted.data.lines
      : null;
  const startHighlight = highlightedRange?.startLine ?? -1;
  const endHighlight = highlightedRange?.endLine ?? -1;

  const githubLink =
    startHighlight > 0
      ? `${fileDetail.githubBlobUrl}#L${startHighlight}-L${endHighlight}`
      : fileDetail.githubBlobUrl;

  const handleSymbolClick = (sym: SymbolInfo) => {
    onSelectRange(
      sym.startLine,
      sym.endLine,
      `${sym.kind}: ${sym.name}`,
      `Language rule extracted ${sym.kind.toLowerCase()} '${sym.name}' spanning lines L${sym.startLine}-L${sym.endLine}.`
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-950">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/70 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="truncate font-mono text-xs font-semibold text-slate-100" title={fileDetail.path}>
            {fileDetail.path}
          </span>
          {startHighlight > 0 && (
            <span className="shrink-0 rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300 border border-emerald-500/30">
              L{startHighlight}-L{endHighlight}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
            {fileDetail.language}
          </span>
          <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 border border-indigo-500/30">
            {
              getRoleMeta(
                refineArchitecturalRole(
                  fileDetail.path,
                  fileDetail.architecturalRole,
                  fileDetail.language
                )
              ).label
            }
          </span>
          <a
            href={githubLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition"
            title="Open file and line range on GitHub"
          >
            <span>GitHub</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Active AI Citation Evidence Banner */}
      {(activeCitation?.filePath === fileDetail.path || highlightedRange?.reason) && (
        <div className="border-b border-emerald-500/30 bg-emerald-950/25 px-4 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-emerald-300">
                    Verified Source Evidence · Lines L{startHighlight}-L{endHighlight}
                  </span>
                  {highlightedRange?.label && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">
                      {highlightedRange.label}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-300 leading-relaxed">
                  {highlightedRange?.reason || activeCitation?.reason}
                </p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30">
              <CheckCircle2 className="h-3 w-3" />
              Line-Verified
            </span>
          </div>
        </div>
      )}

      {/* Language Rules Metadata Bar: Symbols & Dependencies */}
      <div className="border-b border-slate-800/80 bg-slate-900/35 px-4 py-2 space-y-1.5">
        {fileDetail.symbols.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Code2 className="h-3 w-3 text-indigo-400" />
              Symbols:
            </span>
            {fileDetail.symbols.map((sym) => {
              const isSymActive =
                startHighlight === sym.startLine && endHighlight === sym.endLine;
              return (
                <button
                  key={`${sym.name}-${sym.startLine}`}
                  onClick={() => handleSymbolClick(sym)}
                  className={`shrink-0 rounded px-2 py-0.5 font-mono text-[11px] transition border ${
                    isSymActive
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800/80 text-slate-300 border-slate-700/60 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  {sym.name}{' '}
                  <span className="text-[10px] text-slate-400">
                    L{sym.startLine}-{sym.endLine}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {(fileDetail.outgoingDependencies.length > 0 || fileDetail.incomingDependents.length > 0) && (
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            {fileDetail.outgoingDependencies.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                  <ArrowRight className="h-3 w-3 text-indigo-400" />
                  Depends on:
                </span>
                {fileDetail.outgoingDependencies.map((dep) => {
                  const shortName = dep.split('/').pop() || dep;
                  return (
                    <button
                      key={dep}
                      onClick={() => onNavigateToFile(dep)}
                      className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-500/25 border border-indigo-500/20"
                      title={`Inspect ${dep}`}
                    >
                      {shortName}
                    </button>
                  );
                })}
              </div>
            )}

            {fileDetail.incomingDependents.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                  <ArrowLeft className="h-3 w-3 text-emerald-400" />
                  Used by:
                </span>
                {fileDetail.incomingDependents.map((dep) => {
                  const shortName = dep.split('/').pop() || dep;
                  return (
                    <button
                      key={dep}
                      onClick={() => onNavigateToFile(dep)}
                      className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/20"
                      title={`Inspect ${dep}`}
                    >
                      {shortName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Source viewer: VS Code Dark+ / Light+ colours, line numbers & evidence highlight */}
      <div
        className={`flex-1 overflow-auto font-[Consolas,'Cascadia_Code','Courier_New',monospace] text-[13px] leading-[1.55] ${
          isDark ? 'selection:bg-[#264f78]' : 'selection:bg-[#add6ff]'
        }`}
        style={{ backgroundColor: getEditorBackground(theme) }}
      >
        <div className="min-w-max py-2">
          {lines.map((lineText, idx) => {
            const lineNum = idx + 1;
            const isHighlighted =
              startHighlight > 0 && lineNum >= startHighlight && lineNum <= endHighlight;
            const isFirstHighlighted = lineNum === startHighlight;
            const tokens = tokenLines?.[idx];

            return (
              <div
                key={lineNum}
                ref={isFirstHighlighted ? targetLineRef : undefined}
                onClick={() =>
                  onSelectRange(
                    lineNum,
                    lineNum,
                    `Line ${lineNum}`,
                    `Selected source line L${lineNum} in ${fileDetail.path}`
                  )
                }
                className={`group flex cursor-pointer items-baseline px-3 transition-colors ${
                  isHighlighted
                    ? 'border-l-4 border-emerald-400 bg-emerald-400/15'
                    : isDark
                    ? 'border-l-4 border-transparent hover:bg-white/5'
                    : 'border-l-4 border-transparent hover:bg-slate-900/5'
                }`}
              >
                <span
                  className={`w-12 shrink-0 select-none pr-4 text-right text-[12px] ${
                    isHighlighted
                      ? 'font-bold text-emerald-300'
                      : isDark
                      ? 'text-[#6e7b96] group-hover:text-[#c6d0e5]'
                      : 'text-[#6e7681] group-hover:text-[#1e293b]'
                  }`}
                >
                  {lineNum}
                </span>
                <pre
                  className={`whitespace-pre font-[inherit] ${
                    isDark ? 'text-[#d4d4d4]' : 'text-[#24292f]'
                  }`}
                >
                  {tokens && tokens.length > 0
                    ? tokens.map((tok, i) => (
                        <span
                          key={i}
                          style={{
                            color: tok.color,
                            fontStyle: tok.fontStyle && tok.fontStyle & 1 ? 'italic' : undefined,
                            fontWeight: tok.fontStyle && tok.fontStyle & 2 ? 'bold' : undefined,
                            textDecoration:
                              tok.fontStyle && tok.fontStyle & 4 ? 'underline' : undefined,
                          }}
                        >
                          {tok.content}
                        </span>
                      ))
                    : lineText || ' '}
                </pre>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/60 px-4 py-1.5 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <GitCommit className="h-3.5 w-3.5 text-slate-500" />
          {fileDetail.lineCount} lines · {(fileDetail.sizeBytes / 1024).toFixed(1)} KB
        </span>
        <span>Click any line or symbol badge to inspect range</span>
      </div>
    </div>
  );
}
