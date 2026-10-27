import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react';
import {
  GitBranch,
  FolderTree,
  Network,
  Search,
  PlusCircle,
  Database,
  Cpu,
  AlertCircle,
  Sparkles,
  Maximize2,
  Minimize2,
  Table2,
  Zap,
} from 'lucide-react';
import { apiClient } from './api/client';
import type {
  ArchitectureGraph,
  Citation,
  CitedAnswerResponse,
  ErColumn,
  ErDiagram,
  ErEntity,
  RepositorySummary,
  SourceFileDetail,
  SourceFileSummary,
  SystemStatus,
} from './types/api';
import { ArchitectureNode, type ArchNodeData } from './components/ArchitectureNode';
import { LaneNode, type LaneNodeData } from './components/LaneNode';
import { ErDiagramView } from './components/ErDiagramView';
import { ErEntitySummaryCard } from './components/ErEntitySummaryCard';
import { ImpactSummaryCard } from './components/ImpactSummaryCard';
import { EvidenceInspector } from './components/EvidenceInspector';
import { CitedAiPanel } from './components/CitedAiPanel';
import { IndexRepoDialog } from './components/IndexRepoDialog';
import { WelcomeScreen } from './components/WelcomeScreen';
import { MapLegend } from './components/MapLegend';
import { PaneHeader } from './components/PaneHeader';
import { getRoleMeta, relationLabel } from './lib/archMeta';
import { computeImpactReport } from './lib/impactAnalysis';
import { layoutGraph } from './lib/layout';

const nodeTypes = {
  archNode: ArchitectureNode,
  lane: LaneNode,
};

export default function App() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [currentRepo, setCurrentRepo] = useState<RepositorySummary | null>(null);
  const [booting, setBooting] = useState(true);

  const [files, setFiles] = useState<SourceFileSummary[]>([]);
  const [graphData, setGraphData] = useState<ArchitectureGraph | null>(null);
  const [erDiagram, setErDiagram] = useState<ErDiagram | null>(null);
  const [erLoaded, setErLoaded] = useState(false);
  const [history, setHistory] = useState<CitedAnswerResponse[]>([]);

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileDetail, setFileDetail] = useState<SourceFileDetail | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [highlightedColumn, setHighlightedColumn] = useState<string | null>(null);

  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [highlightedRange, setHighlightedRange] = useState<{
    startLine: number;
    endLine: number;
    label?: string;
    reason?: string;
  } | null>(null);

  const [leftView, setLeftView] = useState<'graph' | 'er' | 'tree'>('graph');
  const [impactMode, setImpactMode] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [codeFullscreen, setCodeFullscreen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [fileSearch, setFileSearch] = useState<string>('');

  const [showIndexDialog, setShowIndexDialog] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [buildingEmbeddings, setBuildingEmbeddings] = useState(false);
  const [asking, setAsking] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async (repo: RepositorySummary) => {
    setErrorBanner(null);
    setErLoaded(false);
    try {
      const [fileList, graph, hist, er] = await Promise.all([
        apiClient.listFiles(repo.id),
        apiClient.getArchitectureGraph(repo.id),
        apiClient.getAnalysisHistory(repo.id),
        apiClient.getErDiagram(repo.id).catch(() => null),
      ]);
      setFiles(fileList);
      setGraphData(graph);
      setHistory(hist);
      setErDiagram(er);
      setErLoaded(true);
      setRoleFilter('ALL');
      setFileSearch('');
      setHighlightedColumn(null);
      setSelectedEntityId(er && er.entities.length > 0 ? er.entities[0].id : null);

      if (hist.length > 0 && hist[0].citations.length > 0) {
        const firstCit = hist[0].citations[0];
        setActiveCitation(firstCit);
        setSelectedFilePath(firstCit.filePath);
        setHighlightedRange({
          startLine: firstCit.startLine,
          endLine: firstCit.endLine,
          label: firstCit.symbolName,
          reason: firstCit.reason,
        });
      } else if (fileList.length > 0) {
        const preferred =
          fileList.find((f) => f.architecturalRole === 'CONTROLLER') || fileList[0];
        setActiveCitation(null);
        setHighlightedRange(null);
        setSelectedFilePath(preferred.path);
      }
    } catch (err) {
      setErLoaded(true);
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load repository workspace');
    }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const [status, repoList] = await Promise.all([
        apiClient.getSystemStatus(),
        apiClient.listRepositories(),
      ]);
      setSystemStatus(status);
      setRepos(repoList);
      if (repoList.length > 0) {
        setCurrentRepo(repoList[0]);
        await loadWorkspaceData(repoList[0]);
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? `Backend connection error: ${err.message}`
          : 'Unable to reach Spring Boot backend on /api'
      );
    } finally {
      setBooting(false);
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Esc leaves the full screen code view
  useEffect(() => {
    if (!codeFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCodeFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [codeFullscreen]);

  // Load selected file content whenever selectedFilePath changes
  useEffect(() => {
    if (!currentRepo || !selectedFilePath) {
      setFileDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    apiClient
      .getFileContent(currentRepo.id, selectedFilePath)
      .then((detail) => {
        if (!cancelled) {
          setFileDetail(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorBanner(err instanceof Error ? err.message : 'Failed to load file content');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingFile(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentRepo, selectedFilePath]);

  const handleIndexRepo = async (repoInput: string, branch?: string) => {
    if (indexing) return;
    setIndexing(true);
    setIndexError(null);
    try {
      const indexed = await apiClient.indexRepository(repoInput, branch, false);
      const updatedList = await apiClient.listRepositories();
      setRepos(updatedList);
      setCurrentRepo(indexed);
      setShowIndexDialog(false);
      await loadWorkspaceData(indexed);
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : 'Failed to index repository');
    } finally {
      setIndexing(false);
    }
  };

  const openIndexDialog = () => {
    setIndexError(null);
    setShowIndexDialog(true);
  };

  const handleSelectRepo = async (repoId: number) => {
    const found = repos.find((r) => r.id === repoId);
    if (!found) return;
    setCurrentRepo(found);
    await loadWorkspaceData(found);
  };

  const handleBuildEmbeddings = async () => {
    if (!currentRepo || buildingEmbeddings) return;
    setBuildingEmbeddings(true);
    setErrorBanner(null);
    try {
      const updated = await apiClient.generateEmbeddings(currentRepo.id);
      setCurrentRepo(updated);
      setRepos((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to generate embeddings');
    } finally {
      setBuildingEmbeddings(false);
    }
  };

  const handleSelectCitation = useCallback((citation: Citation) => {
    setActiveCitation(citation);
    setSelectedFilePath(citation.filePath);
    setHighlightedRange({
      startLine: citation.startLine,
      endLine: citation.endLine,
      label: citation.symbolName,
      reason: citation.reason,
    });
  }, []);

  const handleAskQuestion = async (
    question: string,
    retrievalMode: string,
    modelOverride?: string
  ) => {
    if (!currentRepo) return;
    setAsking(true);
    setErrorBanner(null);
    try {
      const response = await apiClient.askQuestion(
        currentRepo.id,
        question,
        retrievalMode || undefined,
        modelOverride
      );
      setHistory((prev) => [response, ...prev]);
      if (response.citations.length > 0) {
        handleSelectCitation(response.citations[0]);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'AI query failed');
    } finally {
      setAsking(false);
    }
  };

  const handleNavigateToFile = useCallback(
    (filePath: string) => {
      setActiveCitation(null);
      setHighlightedRange(null);
      setSelectedFilePath(filePath);
      if (erDiagram) {
        const match = erDiagram.entities.find((e) => e.filePath === filePath);
        if (match) {
          setSelectedEntityId(match.id);
          setHighlightedColumn(null);
        }
      }
    },
    [erDiagram]
  );

  const handleSelectEntity = useCallback((entity: ErEntity) => {
    setSelectedEntityId(entity.id);
    setHighlightedColumn(null);
    setActiveCitation(null);
    setSelectedFilePath(entity.filePath);
    setHighlightedRange({
      startLine: entity.startLine,
      endLine: entity.endLine,
      label: `@Entity ${entity.className} (${entity.tableName})`,
      reason: `JPA entity class '${entity.className}' mapped to database table '${entity.tableName}' (${entity.columns.length} columns).`,
    });
  }, []);

  const handleSelectColumn = useCallback((entity: ErEntity, column: ErColumn) => {
    setSelectedEntityId(entity.id);
    setHighlightedColumn(column.name);
    setActiveCitation(null);
    setSelectedFilePath(column.filePath);
    const fkDetail = column.foreignKey && column.references ? ` → references ${column.references}` : '';
    setHighlightedRange({
      startLine: column.line,
      endLine: column.line,
      label: `${entity.tableName}.${column.name} (${column.sqlType})`,
      reason: `Column '${column.name}' (${column.sqlType}${column.primaryKey ? ', PRIMARY KEY' : ''}${fkDetail}) defined by field '${column.fieldName}'.`,
    });
  }, []);

  // Set of all file paths cited in the latest answer so React Flow highlights them
  const citedFileMap = useMemo(() => {
    const map = new Map<string, string>();
    if (history.length > 0) {
      for (const c of history[0].citations) {
        if (!map.has(c.filePath)) {
          map.set(c.filePath, `L${c.startLine}-L${c.endLine}`);
        }
      }
    }
    return map;
  }, [history]);

  // Transitive impact analysis (blast radius + upstream dependencies) for the selected file
  const impactReport = useMemo(
    () => computeImpactReport(graphData, selectedFilePath),
    [graphData, selectedFilePath]
  );

  const selectedGraphNode = useMemo(
    () => graphData?.nodes.find((n) => n.id === selectedFilePath) ?? null,
    [graphData, selectedFilePath]
  );

  const selectedErEntity = useMemo(
    () => erDiagram?.entities.find((e) => e.id === selectedEntityId) ?? null,
    [erDiagram, selectedEntityId]
  );

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!graphData) return { flowNodes: [] as Node[], flowEdges: [] as Edge[] };

    const query = fileSearch.trim().toLowerCase();
    const visible = graphData.nodes
      .filter((n) => roleFilter === 'ALL' || n.architecturalRole === roleFilter)
      .filter(
        (n) =>
          !query ||
          n.path.toLowerCase().includes(query) ||
          n.symbols.some((s) => s.toLowerCase().includes(query))
      );

    const layout = layoutGraph(visible);
    const downHops = impactReport?.downstreamHops ?? new Map<string, number>();
    const upHops = impactReport?.upstreamHops ?? new Map<string, number>();

    const related = new Set<string>();
    if (selectedFilePath) {
      related.add(selectedFilePath);
      for (const [p, h] of downHops.entries()) {
        if (impactMode || h === 1) related.add(p);
      }
      for (const [p, h] of upHops.entries()) {
        if (impactMode || h === 1) related.add(p);
      }
    }
    const hasFocus = !!selectedGraphNode;

    const laneNodes: Node[] = layout.lanes.map((lane) => {
      const data: LaneNodeData = {
        title: lane.title,
        subtitle: lane.subtitle,
        color: lane.color,
        count: lane.count,
        width: lane.width,
        height: lane.height,
      };
      return {
        id: lane.id,
        type: 'lane',
        position: { x: lane.x, y: lane.y },
        data,
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        style: { pointerEvents: 'none' },
      };
    });

    const archNodes: Node[] = visible.map((n) => {
      const dHop = downHops.get(n.path);
      const uHop = upHops.get(n.path);
      const impactKind: 'downstream' | 'upstream' | null =
        impactMode && dHop
          ? 'downstream'
          : impactMode && uHop
          ? 'upstream'
          : null;
      const impactHops = impactKind === 'downstream' ? dHop : impactKind === 'upstream' ? uHop : undefined;

      const data: ArchNodeData = {
        path: n.path,
        label: n.label,
        directory: n.directory,
        language: n.language,
        architecturalRole: n.architecturalRole,
        tier: n.tier,
        lineCount: n.lineCount,
        symbols: n.symbols,
        incomingCount: n.incomingCount,
        outgoingCount: n.outgoingCount,
        isSelected: n.path === selectedFilePath,
        isCited: citedFileMap.has(n.path),
        isDimmed: hasFocus && !related.has(n.id) && !citedFileMap.has(n.id),
        citationLines: citedFileMap.get(n.path),
        impactKind,
        impactHops,
      };
      return {
        id: n.id,
        type: 'archNode',
        position: layout.positions.get(n.id) ?? { x: 0, y: 0 },
        data,
      };
    });

    const visibleIds = new Set(visible.map((n) => n.id));
    const edges: Edge[] = graphData.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => {
        const isDirectOutgoing = e.source === selectedFilePath;
        const isDirectIncoming = e.target === selectedFilePath;
        const isDownstreamChain =
          impactMode &&
          (e.target === selectedFilePath || downHops.has(e.target)) &&
          downHops.has(e.source);
        const isUpstreamChain =
          impactMode &&
          (e.source === selectedFilePath || upHops.has(e.source)) &&
          upHops.has(e.target);

        const isConnected =
          isDirectOutgoing || isDirectIncoming || isDownstreamChain || isUpstreamChain;
        const isApiCall = e.relationType === 'API_CALL';

        const color = isDownstreamChain
          ? isDirectIncoming
            ? '#fb7185'
            : '#f59e0b'
          : isDirectIncoming
          ? '#34d399'
          : isDirectOutgoing || isUpstreamChain
          ? '#818cf8'
          : isApiCall
          ? '#ec4899'
          : '#475569';

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          label: isConnected ? relationLabel(e.relationType) : undefined,
          animated: isConnected,
          labelStyle: { fill: '#e2e8f0', fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          style: {
            stroke: color,
            strokeWidth: isConnected ? 2.4 : 1.4,
            strokeDasharray: isApiCall ? '6 4' : undefined,
            opacity: hasFocus && !isConnected ? 0.25 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        };
      });

    return { flowNodes: [...laneNodes, ...archNodes], flowEdges: edges };
  }, [
    graphData,
    roleFilter,
    fileSearch,
    selectedFilePath,
    selectedGraphNode,
    impactReport,
    impactMode,
    citedFileMap,
  ]);

  const visibleFileCount = useMemo(
    () => flowNodes.filter((n) => n.type === 'archNode').length,
    [flowNodes]
  );

  const filteredFiles = useMemo(() => {
    return files
      .filter((f) => roleFilter === 'ALL' || f.architecturalRole === roleFilter)
      .filter(
        (f) =>
          !fileSearch.trim() ||
          f.path.toLowerCase().includes(fileSearch.trim().toLowerCase())
      );
  }, [files, roleFilter, fileSearch]);

  const availableRoles = useMemo(() => {
    if (!graphData) return [];
    return Object.keys(graphData.roleCounts);
  }, [graphData]);

  const languages = useMemo(
    () => (graphData ? Object.keys(graphData.languageCounts) : []),
    [graphData]
  );

  const erTableCount = erDiagram?.entities.length ?? 0;
  const erRelationCount = erDiagram?.relations.length ?? 0;

  const showWelcome = !booting && repos.length === 0 && !currentRepo;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Workspace Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-600/30 to-cyan-600/20">
              <GitBranch className="h-4.5 w-4.5 text-indigo-300" />
            </div>
            <div>
              <div className="bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-base font-extrabold leading-tight tracking-tight text-transparent">
                VisualRepo
              </div>
              <p className="text-[11px] leading-tight text-slate-400">
                Understand any codebase: map it, read it, ask it
              </p>
            </div>
          </div>

          {repos.length > 0 && (
            <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
              <label htmlFor="repo-switcher" className="text-[11px] text-slate-400">
                Repository
              </label>
              <select
                id="repo-switcher"
                value={currentRepo?.id || ''}
                onChange={(e) => handleSelectRepo(Number(e.target.value))}
                className="max-w-[260px] rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.owner}/{r.name} ({r.fileCount} files)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 text-[11px] lg:flex">
            <span
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/90 px-2 py-1 text-slate-300"
              title={systemStatus?.databaseMode}
            >
              <Database className="h-3 w-3 text-indigo-400" />
              <span className="max-w-[140px] truncate">
                {systemStatus?.databaseMode.split('(')[0].trim() || 'Database'}
              </span>
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
                systemStatus?.ollamaOnline
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
              title={
                systemStatus?.ollamaOnline
                  ? `${systemStatus.availableOllamaModels.length} Ollama models available`
                  : 'Ollama is not reachable, so answers use a basic fallback'
              }
            >
              <Cpu className="h-3 w-3" />
              <span>{systemStatus?.ollamaOnline ? 'AI online' : 'AI offline (fallback)'}</span>
            </span>
          </div>

          <button
            onClick={openIndexDialog}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:from-indigo-500 hover:to-cyan-500"
          >
            <PlusCircle className="h-4 w-4" />
            Analyze a repository
          </button>
        </div>
      </header>

      {/* Error Alert Banner */}
      {errorBanner && (
        <div className="flex items-center justify-between border-b border-rose-500/40 bg-rose-950/80 px-4 py-2 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-[11px] text-rose-300 underline hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {booting ? (
        <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <p className="mt-3 text-xs">Connecting to the VisualRepo backend…</p>
        </div>
      ) : showWelcome ? (
        <WelcomeScreen
          onSubmit={handleIndexRepo}
          indexing={indexing}
          error={indexError}
          githubTokenConfigured={systemStatus?.githubTokenConfigured}
        />
      ) : (
        <main className="grid flex-1 grid-cols-12 overflow-hidden">
          {/* LEFT PANE: Architecture map, Database ER diagram & file list */}
          <section
            className={`flex flex-col overflow-hidden border-r border-slate-800 ${
              graphExpanded ? 'col-span-12' : 'col-span-5'
            }`}
          >
            <PaneHeader
              step={1}
              title={leftView === 'er' ? 'Database ER diagram' : 'Architecture & Impact'}
              subtitle={
                leftView === 'er'
                  ? 'Tables, columns, primary/foreign keys and relationships'
                  : impactMode
                  ? 'Blast radius: highlighting every file affected if the selected file changes'
                  : 'Layers of the app and how its files depend on each other'
              }
              actions={
                leftView !== 'tree' ? (
                  <div className="flex items-center gap-1.5">
                    {leftView === 'graph' && (
                      <button
                        onClick={() => setImpactMode((v) => !v)}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                          impactMode
                            ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                            : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-amber-500/50 hover:text-white'
                        }`}
                        title="Toggle multi-hop Impact Analysis (blast radius) on the map"
                      >
                        <Zap className="h-3.5 w-3.5 text-amber-400" />
                        Impact
                      </button>
                    )}
                    <button
                      onClick={() => setGraphExpanded((v) => !v)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-white"
                      title={graphExpanded ? 'Back to the three-panel view' : 'Make the diagram fill the screen'}
                    >
                      {graphExpanded ? (
                        <Minimize2 className="h-3.5 w-3.5" />
                      ) : (
                        <Maximize2 className="h-3.5 w-3.5" />
                      )}
                      {graphExpanded ? 'Back to code' : 'Full screen'}
                    </button>
                  </div>
                ) : undefined
              }
            />

            {/* Overview strip */}
            {graphData && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800/80 bg-slate-900/40 px-4 py-1.5 text-[11px] text-slate-400">
                {leftView === 'er' ? (
                  <>
                    <span>
                      <strong className="text-slate-200">{erTableCount}</strong> tables
                    </span>
                    <span>
                      <strong className="text-slate-200">{erRelationCount}</strong> foreign-key relations
                    </span>
                    <span className="truncate">
                      Click a table or column row to jump to its exact line in code
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <strong className="text-slate-200">{graphData.nodes.length}</strong> files
                    </span>
                    <span>
                      <strong className="text-slate-200">{graphData.edges.length}</strong> connections
                    </span>
                    <span className="truncate">
                      Languages: <strong className="text-slate-200">{languages.join(', ') || '—'}</strong>
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/70 px-3 py-2">
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
                <button
                  onClick={() => setLeftView('graph')}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                    leftView === 'graph'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Network className="h-3.5 w-3.5" />
                  Map ({visibleFileCount})
                </button>
                <button
                  onClick={() => setLeftView('er')}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                    leftView === 'er'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Entity-Relationship diagram of database tables"
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Database ER ({erTableCount})
                </button>
                <button
                  onClick={() => {
                    setLeftView('tree');
                    setGraphExpanded(false);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                    leftView === 'tree'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FolderTree className="h-3.5 w-3.5" />
                  Files ({filteredFiles.length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    placeholder={
                      leftView === 'er' ? 'Find a table or column…' : 'Find a file or function…'
                    }
                    aria-label={
                      leftView === 'er' ? 'Find a table or column' : 'Find a file or function'
                    }
                    className="w-40 rounded-lg border border-slate-800 bg-slate-950 py-1 pl-7 pr-2 text-xs text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                {leftView !== 'er' && (
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    aria-label="Filter by file type"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ALL">All types ({files.length})</option>
                    {availableRoles.map((role) => (
                      <option key={role} value={role}>
                        {getRoleMeta(role).label} ({graphData?.roleCounts[role]})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Graph, ER diagram or file list */}
            <div className="relative flex-1 overflow-hidden bg-slate-950">
              {leftView === 'graph' ? (
                <>
                  <MapLegend />
                  {visibleFileCount === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-400">
                      <Network className="mb-2 h-8 w-8 text-slate-700" />
                      <p className="text-sm font-medium text-slate-300">No files match your filter</p>
                      <p className="mt-1 text-xs">Clear the search box or choose “All types”.</p>
                    </div>
                  ) : (
                    <ReactFlow
                      key={`${currentRepo?.id}-${roleFilter}-${visibleFileCount}-${graphExpanded}`}
                      nodes={flowNodes}
                      edges={flowEdges}
                      nodeTypes={nodeTypes}
                      onNodeClick={(_, node) => {
                        if (node.type === 'lane') return;
                        handleNavigateToFile(node.id);
                      }}
                      nodesConnectable={false}
                      fitView
                      fitViewOptions={{ padding: 0.12 }}
                      minZoom={0.15}
                      maxZoom={1.6}
                    >
                      <Background color="#1e293b" gap={22} />
                      <Controls
                        showInteractive={false}
                        className="!border-slate-700 !bg-slate-900 !text-slate-200"
                      />
                      {graphExpanded && (
                        <MiniMap
                          nodeColor={(n) =>
                            n.type === 'lane'
                              ? 'transparent'
                              : citedFileMap.has(n.id)
                              ? '#10b981'
                              : n.id === selectedFilePath
                              ? '#6366f1'
                              : '#334155'
                          }
                          maskColor="rgba(2, 6, 23, 0.75)"
                          className="!rounded-lg !border !border-slate-800 !bg-slate-900/90"
                        />
                      )}
                    </ReactFlow>
                  )}
                </>
              ) : leftView === 'er' ? (
                <ErDiagramView
                  diagram={erDiagram}
                  loaded={erLoaded}
                  query={fileSearch}
                  selectedEntityId={selectedEntityId}
                  highlightedColumn={highlightedColumn}
                  expanded={graphExpanded}
                  onSelectEntity={handleSelectEntity}
                  onSelectColumn={handleSelectColumn}
                />
              ) : (
                <div className="h-full divide-y divide-slate-800/60 overflow-y-auto">
                  {filteredFiles.length === 0 && (
                    <p className="p-6 text-center text-xs text-slate-500">No files match your filter.</p>
                  )}
                  {filteredFiles.map((f) => {
                    const isSelected = f.path === selectedFilePath;
                    const isCited = citedFileMap.has(f.path);
                    const role = getRoleMeta(f.architecturalRole);
                    const RoleIcon = role.icon;
                    return (
                      <button
                        key={f.id}
                        onClick={() => handleNavigateToFile(f.path)}
                        className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition ${
                          isSelected
                            ? 'border-l-4 border-indigo-400 bg-indigo-600/15'
                            : 'border-l-4 border-transparent hover:bg-slate-900/70'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${role.iconBox}`}
                          >
                            <RoleIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <span className="block truncate font-mono text-xs font-medium text-slate-200">
                              {f.path}
                            </span>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                              <span className={`rounded border px-1.5 py-0.5 font-semibold ${role.badge}`}>
                                {role.label}
                              </span>
                              <span>{f.language}</span>
                              <span>{f.lineCount} lines</span>
                              <span>{f.symbolCount} functions/classes</span>
                            </div>
                          </div>
                        </div>
                        {isCited && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                            <Sparkles className="h-2.5 w-2.5" />
                            {citedFileMap.get(f.path)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom context card: ER table details in ER mode, or File + Impact Analysis in Map/Files mode */}
            {leftView === 'er' && selectedErEntity && erDiagram ? (
              <ErEntitySummaryCard
                entity={selectedErEntity}
                diagram={erDiagram}
                expanded={graphExpanded}
                onSelectEntityById={(id) => {
                  const found = erDiagram.entities.find((e) => e.id === id);
                  if (found) handleSelectEntity(found);
                }}
                onExitExpanded={() => setGraphExpanded(false)}
              />
            ) : (
              selectedGraphNode && (
                <ImpactSummaryCard
                  node={selectedGraphNode}
                  impact={impactReport}
                  impactMode={impactMode}
                  graphExpanded={graphExpanded}
                  onToggleImpactMode={() => setImpactMode((v) => !v)}
                  onSelectFile={handleNavigateToFile}
                  onExitExpanded={() => setGraphExpanded(false)}
                />
              )
            )}
          </section>

          {/* CENTER PANE: Source code & line-range evidence */}
          <section
            className={
              codeFullscreen
                ? 'fixed inset-0 z-40 flex flex-col overflow-hidden bg-slate-950'
                : `col-span-4 flex-col overflow-hidden border-r border-slate-800 ${
                    graphExpanded ? 'hidden' : 'flex'
                  }`
            }
          >
            <PaneHeader
              step={2}
              title="Source code"
              subtitle={
                codeFullscreen
                  ? 'Full screen · press Esc to exit'
                  : 'The real file, with exact line numbers'
              }
              actions={
                <button
                  onClick={() => setCodeFullscreen((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-white"
                  title={codeFullscreen ? 'Exit full screen (Esc)' : 'View the code in full screen'}
                >
                  {codeFullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                  {codeFullscreen ? 'Exit full screen' : 'Full screen'}
                </button>
              }
            />
            <div className="min-h-0 flex-1">
              <EvidenceInspector
                fileDetail={fileDetail}
                loading={loadingFile}
                activeCitation={activeCitation}
                highlightedRange={highlightedRange}
                onSelectRange={(startLine, endLine, label, reason) =>
                  setHighlightedRange({ startLine, endLine, label, reason })
                }
                onNavigateToFile={handleNavigateToFile}
              />
            </div>
          </section>

          {/* RIGHT PANE: Cited AI assistant */}
          <section
            className={`col-span-3 flex-col overflow-hidden ${graphExpanded ? 'hidden' : 'flex'}`}
          >
            <CitedAiPanel
              currentRepo={currentRepo}
              systemStatus={systemStatus}
              history={history}
              asking={asking}
              buildingEmbeddings={buildingEmbeddings}
              activeCitation={activeCitation}
              onAskQuestion={handleAskQuestion}
              onBuildEmbeddings={handleBuildEmbeddings}
              onSelectCitation={handleSelectCitation}
            />
          </section>
        </main>
      )}

      <IndexRepoDialog
        open={showIndexDialog}
        repos={repos}
        currentRepoId={currentRepo?.id}
        indexing={indexing}
        error={indexError}
        githubTokenConfigured={systemStatus?.githubTokenConfigured}
        onClose={() => setShowIndexDialog(false)}
        onSubmit={handleIndexRepo}
        onSelectRepo={handleSelectRepo}
      />
    </div>
  );
}
