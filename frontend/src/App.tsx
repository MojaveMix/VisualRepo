import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
  ArrowLeftRight,
  RotateCcw,
  PictureInPicture2,
  ChevronLeft,
  ChevronRight,
  Minus,
  Columns3,
  Layers,
  Eye,
  EyeOff,
  Box,
} from 'lucide-react';
import { apiClient } from './api/client';
import type {
  ArchitectureGraph,
  Citation,
  CitedAnswerResponse,
  ErColumn,
  ErDiagram,
  ErEntity,
  InsightEngine,
  ProjectInsights,
  RepositorySummary,
  SourceFileDetail,
  SourceFileSummary,
  SystemStatus,
} from './types/api';
import { ArchitectureNode, type ArchNodeData } from './components/ArchitectureNode';
import { LaneNode, type LaneNodeData } from './components/LaneNode';
import { LayerSummaryNode, type LayerSummaryNodeData } from './components/LayerSummaryNode';
import { ErDiagramView } from './components/ErDiagramView';
import { ErEntitySummaryCard } from './components/ErEntitySummaryCard';
import { Relational3DView } from './components/Relational3DView';
import { DeepInsightsBar } from './components/DeepInsightsBar';
import { ImpactSummaryCard } from './components/ImpactSummaryCard';
import { EvidenceInspector } from './components/EvidenceInspector';
import { CitedAiPanel } from './components/CitedAiPanel';
import { IndexRepoDialog } from './components/IndexRepoDialog';
import { WelcomeScreen } from './components/WelcomeScreen';
import { MapLegend } from './components/MapLegend';
import { PaneHeader, type PaneDragHandlers, type PaneId } from './components/PaneHeader';
import { ThemeToggle } from './components/ThemeToggle';
import {
  getLayerMeta,
  getRoleMeta,
  LAYERS,
  refineArchitecturalRole,
  relationLabel,
  resolveNodeLayerKey,
} from './lib/archMeta';
import {
  applyInsightsToErDiagram,
  applyInsightsToGraph,
  computeClientSideInsights,
  getClusterColor,
} from './lib/deepInsightsClient';
import { computeImpactReport } from './lib/impactAnalysis';
import { archEdgeSides, layoutGraph, layoutOverview, OVERVIEW_NODE_HEIGHT, OVERVIEW_NODE_WIDTH } from './lib/layout';
import { useTheme } from './lib/theme';

const nodeTypes = {
  archNode: ArchitectureNode,
  lane: LaneNode,
  layerSummary: LayerSummaryNode,
};

/** Above this many dependencies the detailed map hides unrelated arrows until a file is selected. */
const AUTO_SHOW_ALL_EDGES_LIMIT = 30;

const PANE_ORDER_KEY = 'visualrepo.paneOrder';
const PANE_WIDTHS_KEY = 'visualrepo.paneWidths';
const SIDE_BOXES_KEY = 'visualrepo.sideBoxes';
const DEFAULT_PANE_ORDER: PaneId[] = ['map', 'code', 'ai'];
const DEFAULT_PANE_WIDTHS: Record<PaneId, number> = {
  map: 42,
  code: 33,
  ai: 25,
};

export type SideDockSide = 'left' | 'right';

export interface SideBoxConfig {
  side: SideDockSide;
  minimized: boolean;
}

const PANE_LABELS: Record<PaneId, string> = {
  map: 'Architecture & Impact',
  code: 'Source code',
  ai: 'Ask the AI',
};

function loadInitialSideBoxes(): Partial<Record<PaneId, SideBoxConfig>> {
  try {
    const raw = window.localStorage.getItem(SIDE_BOXES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const valid: Partial<Record<PaneId, SideBoxConfig>> = {};
      for (const id of DEFAULT_PANE_ORDER) {
        if (
          parsed[id] &&
          (parsed[id].side === 'left' || parsed[id].side === 'right') &&
          typeof parsed[id].minimized === 'boolean'
        ) {
          valid[id] = parsed[id];
        }
      }
      // Keep at least 1 panel in the main workspace
      if (Object.keys(valid).length < 3) {
        return valid;
      }
    }
  } catch {
    // ignore storage errors
  }
  return {};
}

function loadInitialPaneOrder(): PaneId[] {
  try {
    const raw = window.localStorage.getItem(PANE_ORDER_KEY);
    if (!raw) return DEFAULT_PANE_ORDER;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      DEFAULT_PANE_ORDER.every((id) => parsed.includes(id))
    ) {
      return parsed as PaneId[];
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_PANE_ORDER;
}

function loadInitialPaneWidths(): Record<PaneId, number> {
  try {
    const raw = window.localStorage.getItem(PANE_WIDTHS_KEY);
    if (!raw) return DEFAULT_PANE_WIDTHS;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.map === 'number' &&
      typeof parsed.code === 'number' &&
      typeof parsed.ai === 'number'
    ) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_PANE_WIDTHS;
}

export default function App() {
  const { theme, isDark } = useTheme();
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [currentRepo, setCurrentRepo] = useState<RepositorySummary | null>(null);
  const [booting, setBooting] = useState(true);

  const [files, setFiles] = useState<SourceFileSummary[]>([]);
  const [rawGraphData, setRawGraphData] = useState<ArchitectureGraph | null>(null);
  const [rawErDiagram, setRawErDiagram] = useState<ErDiagram | null>(null);
  const [erLoaded, setErLoaded] = useState(false);
  const [history, setHistory] = useState<CitedAnswerResponse[]>([]);

  // Deep Architecture & ER Insights (Algorithm | Ollama AI Local)
  const [insightEngine, setInsightEngine] = useState<InsightEngine>('algorithm');
  const [insightModel, setInsightModel] = useState<string>('');
  const [backendInsights, setBackendInsights] = useState<ProjectInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [activeClusterId, setActiveClusterId] = useState<number | null>(null);
  const [showInferredEr, setShowInferredEr] = useState(true);

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

  const [leftView, setLeftView] = useState<'graph' | '3d' | 'er' | 'tree'>('graph');
  // 'overview' = one card per architectural layer (the big picture); 'detail' = every file.
  const [mapMode, setMapMode] = useState<'overview' | 'detail'>('overview');
  // When set (in detail mode), the camera zooms to this layer's lane on load.
  const [focusLayerId, setFocusLayerId] = useState<string | null>(null);
  // null = automatic (hide unrelated arrows only when the repo has many dependencies)
  const [showAllEdges, setShowAllEdges] = useState<boolean | null>(null);
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

  // Editor-style draggable & resizable workspace panes + Side Boxes
  const [paneOrder, setPaneOrder] = useState<PaneId[]>(loadInitialPaneOrder);
  const [paneWidths, setPaneWidths] = useState<Record<PaneId, number>>(loadInitialPaneWidths);
  const [sideBoxes, setSideBoxes] = useState<Partial<Record<PaneId, SideBoxConfig>>>(
    loadInitialSideBoxes
  );
  const [draggingPane, setDraggingPane] = useState<PaneId | null>(null);
  const [dragOverPane, setDragOverPane] = useState<PaneId | null>(null);
  const [dragOverSideZone, setDragOverSideZone] = useState<SideDockSide | null>(null);
  const [settledPanes, setSettledPanes] = useState<PaneId[]>([]);
  const [activeResizer, setActiveResizer] = useState<number | null>(null);

  const workspaceRef = useRef<HTMLElement | null>(null);
  const paneRefs = useRef<Record<PaneId, HTMLElement | null>>({
    map: null,
    code: null,
    ai: null,
  });
  const prevRectsRef = useRef<Partial<Record<PaneId, DOMRect>>>({});

  const capturePaneRects = useCallback(() => {
    const rects: Partial<Record<PaneId, DOMRect>> = {};
    for (const id of DEFAULT_PANE_ORDER) {
      const el = paneRefs.current[id];
      if (el) rects[id] = el.getBoundingClientRect();
    }
    prevRectsRef.current = rects;
  }, []);

  // FLIP animation whenever paneOrder changes
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    const movedIds: PaneId[] = [];

    for (const id of paneOrder) {
      const el = paneRefs.current[id];
      const prev = prevRects[id];
      if (!el || !prev) continue;
      const next = el.getBoundingClientRect();
      const deltaX = prev.left - next.left;
      if (Math.abs(deltaX) > 2) {
        movedIds.push(id);
        el.style.transition = 'none';
        el.style.transform = `translate3d(${deltaX}px, 0, 0)`;
        // Force layout reflow before playing the smooth cubic-bezier glide
        void el.offsetWidth;
        el.style.transition = 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = 'translate3d(0, 0, 0)';
      }
    }

    prevRectsRef.current = {};

    if (movedIds.length > 0) {
      setSettledPanes(movedIds);
      const timer = window.setTimeout(() => {
        for (const id of movedIds) {
          const el = paneRefs.current[id];
          if (el) {
            el.style.transition = '';
            el.style.transform = '';
          }
        }
        setSettledPanes([]);
      }, 680);
      return () => window.clearTimeout(timer);
    }
  }, [paneOrder, sideBoxes]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PANE_ORDER_KEY, JSON.stringify(paneOrder));
    } catch {
      // ignore storage errors
    }
  }, [paneOrder]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PANE_WIDTHS_KEY, JSON.stringify(paneWidths));
    } catch {
      // ignore storage errors
    }
  }, [paneWidths]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDE_BOXES_KEY, JSON.stringify(sideBoxes));
    } catch {
      // ignore storage errors
    }
  }, [sideBoxes]);

  const mainPanes = useMemo(
    () => paneOrder.filter((id) => !sideBoxes[id]),
    [paneOrder, sideBoxes]
  );

  const normalizedMainWidths = useMemo(() => {
    const total = mainPanes.reduce((sum, id) => sum + (paneWidths[id] || 33), 0) || 100;
    const map: Record<PaneId, number> = { ...paneWidths };
    for (const id of mainPanes) {
      map[id] = ((paneWidths[id] || 33) / total) * 100;
    }
    return map;
  }, [mainPanes, paneWidths]);

  const dockPaneToSideBox = useCallback(
    (paneId: PaneId, side: SideDockSide) => {
      // Ensure at least 1 panel remains in the main workspace
      const remainingMain = paneOrder.filter((id) => id !== paneId && !sideBoxes[id]);
      if (remainingMain.length === 0) return;
      capturePaneRects();
      setSideBoxes((prev) => ({
        ...prev,
        [paneId]: { side, minimized: false },
      }));
    },
    [paneOrder, sideBoxes, capturePaneRects]
  );

  const undockSideBoxToMain = useCallback(
    (paneId: PaneId, targetSlotPaneId?: PaneId) => {
      capturePaneRects();
      setSideBoxes((prev) => {
        const next = { ...prev };
        delete next[paneId];
        return next;
      });
      if (targetSlotPaneId && targetSlotPaneId !== paneId) {
        setPaneOrder((prev) => {
          const filtered = prev.filter((id) => id !== paneId);
          const tgtIdx = filtered.indexOf(targetSlotPaneId);
          if (tgtIdx === -1) return prev;
          filtered.splice(tgtIdx, 0, paneId);
          return filtered;
        });
      }
    },
    [capturePaneRects]
  );

  const toggleSideBoxMinimized = useCallback((paneId: PaneId) => {
    setSideBoxes((prev) => {
      const current = prev[paneId];
      if (!current) return prev;
      return {
        ...prev,
        [paneId]: { ...current, minimized: !current.minimized },
      };
    });
  }, []);

  const flipSideBoxSide = useCallback((paneId: PaneId) => {
    setSideBoxes((prev) => {
      const current = prev[paneId];
      if (!current) return prev;
      return {
        ...prev,
        [paneId]: {
          ...current,
          side: current.side === 'left' ? 'right' : 'left',
          minimized: false,
        },
      };
    });
  }, []);

  const reorderPanes = useCallback(
    (sourceId: PaneId, targetId: PaneId) => {
      if (sourceId === targetId) return;
      capturePaneRects();
      // If source was in a side box and dropped onto a main pane, undock it into that slot!
      if (sideBoxes[sourceId] && !sideBoxes[targetId]) {
        undockSideBoxToMain(sourceId, targetId);
        return;
      }
      setPaneOrder((prev) => {
        const next = [...prev];
        const srcIdx = next.indexOf(sourceId);
        const tgtIdx = next.indexOf(targetId);
        if (srcIdx === -1 || tgtIdx === -1) return prev;
        next[srcIdx] = targetId;
        next[tgtIdx] = sourceId;
        return next;
      });
    },
    [capturePaneRects, sideBoxes, undockSideBoxToMain]
  );

  const handleMovePaneByOffset = useCallback(
    (paneId: PaneId, offset: -1 | 1) => {
      const idx = mainPanes.indexOf(paneId);
      const targetIdx = idx + offset;
      if (idx === -1 || targetIdx < 0 || targetIdx >= mainPanes.length) return;
      reorderPanes(paneId, mainPanes[targetIdx]);
    },
    [mainPanes, reorderPanes]
  );

  const handleResetLayout = useCallback(() => {
    capturePaneRects();
    setPaneOrder(DEFAULT_PANE_ORDER);
    setPaneWidths(DEFAULT_PANE_WIDTHS);
    setSideBoxes({});
  }, [capturePaneRects]);

  const isLayoutCustomized = useMemo(() => {
    const orderChanged = paneOrder.some((id, idx) => id !== DEFAULT_PANE_ORDER[idx]);
    const widthsChanged = DEFAULT_PANE_ORDER.some(
      (id) => Math.abs(paneWidths[id] - DEFAULT_PANE_WIDTHS[id]) > 0.5
    );
    const hasSideBoxes = Object.keys(sideBoxes).length > 0;
    return orderChanged || widthsChanged || hasSideBoxes;
  }, [paneOrder, paneWidths, sideBoxes]);

  const handlePaneDragStart = useCallback((e: DragEvent<HTMLElement>, paneId: PaneId) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', paneId);
    setDraggingPane(paneId);
  }, []);

  const handlePaneDragEnd = useCallback(() => {
    setDraggingPane(null);
    setDragOverPane(null);
    setDragOverSideZone(null);
  }, []);

  const handlePaneDragOver = useCallback(
    (e: DragEvent<HTMLElement>, targetPaneId: PaneId) => {
      if (!draggingPane || draggingPane === targetPaneId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverSideZone(null);
      if (dragOverPane !== targetPaneId) {
        setDragOverPane(targetPaneId);
      }
    },
    [draggingPane, dragOverPane]
  );

  const handlePaneDrop = useCallback(
    (e: DragEvent<HTMLElement>, targetPaneId: PaneId) => {
      e.preventDefault();
      const sourceId = (draggingPane || e.dataTransfer.getData('text/plain')) as PaneId;
      setDraggingPane(null);
      setDragOverPane(null);
      setDragOverSideZone(null);
      if (sourceId && DEFAULT_PANE_ORDER.includes(sourceId) && sourceId !== targetPaneId) {
        reorderPanes(sourceId, targetPaneId);
      }
    },
    [draggingPane, reorderPanes]
  );

  const handleSideZoneDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, side: SideDockSide) => {
      if (!draggingPane) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverPane(null);
      if (dragOverSideZone !== side) {
        setDragOverSideZone(side);
      }
    },
    [draggingPane, dragOverSideZone]
  );

  const handleSideZoneDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, side: SideDockSide) => {
      e.preventDefault();
      e.stopPropagation();
      const sourceId = (draggingPane || e.dataTransfer.getData('text/plain')) as PaneId;
      setDraggingPane(null);
      setDragOverPane(null);
      setDragOverSideZone(null);
      if (sourceId && DEFAULT_PANE_ORDER.includes(sourceId)) {
        dockPaneToSideBox(sourceId, side);
      }
    },
    [draggingPane, dockPaneToSideBox]
  );

  const startResizeSplit = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, splitIdx: number) => {
      e.preventDefault();
      const container = workspaceRef.current;
      if (!container) return;
      const leftId = mainPanes[splitIdx];
      const rightId = mainPanes[splitIdx + 1];
      if (!leftId || !rightId) return;

      const startX = e.clientX;
      const totalWidth = container.getBoundingClientRect().width || 1;
      const startLeftWidth = normalizedMainWidths[leftId];
      const startRightWidth = normalizedMainWidths[rightId];
      const combined = startLeftWidth + startRightWidth;
      const minPct = 18;

      setActiveResizer(splitIdx);

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaPct = ((moveEvent.clientX - startX) / totalWidth) * 100;
        const nextLeft = Math.min(
          combined - minPct,
          Math.max(minPct, startLeftWidth + deltaPct)
        );
        const nextRight = combined - nextLeft;
        setPaneWidths((prev) => ({
          ...prev,
          [leftId]: Math.round(nextLeft * 10) / 10,
          [rightId]: Math.round(nextRight * 10) / 10,
        }));
      };

      const onMouseUp = () => {
        setActiveResizer(null);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [mainPanes, normalizedMainWidths]
  );

  const loadDeepInsights = useCallback(
    async (repoId: number, engine: InsightEngine, model?: string, refresh = false) => {
      setLoadingInsights(true);
      try {
        const res = await apiClient.getProjectInsights(
          repoId,
          engine,
          model || undefined,
          refresh
        );
        setBackendInsights(res);
      } catch {
        // Client-side deep insights fallback remains active if the endpoint is unreachable
      } finally {
        setLoadingInsights(false);
      }
    },
    []
  );

  const loadWorkspaceData = useCallback(
    async (repo: RepositorySummary) => {
      setErrorBanner(null);
      setErLoaded(false);
      setBackendInsights(null);
      setActiveClusterId(null);
      try {
        const [fileList, graph, hist, er] = await Promise.all([
          apiClient.listFiles(repo.id),
          apiClient.getArchitectureGraph(repo.id),
          apiClient.getAnalysisHistory(repo.id),
          apiClient.getErDiagram(repo.id).catch(() => null),
        ]);
        setFiles(fileList);
        setRawGraphData(graph);
        setHistory(hist);
        setRawErDiagram(er);
        setErLoaded(true);
        setRoleFilter('ALL');
        setMapMode('overview');
        setFocusLayerId(null);
        setShowAllEdges(null);
        setFileSearch('');
        setHighlightedColumn(null);
        setSelectedEntityId(er && er.entities.length > 0 ? er.entities[0].id : null);

        void loadDeepInsights(repo.id, insightEngine, insightModel, false);

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
    },
    [insightEngine, insightModel, loadDeepInsights]
  );

  const bootstrap = useCallback(async () => {
    try {
      const [status, repoList] = await Promise.all([
        apiClient.getSystemStatus(),
        apiClient.listRepositories(),
      ]);
      setSystemStatus(status);
      if (status.configuredChatModel) {
        setInsightModel(status.configuredChatModel);
      } else if (status.availableOllamaModels.length > 0) {
        setInsightModel(status.availableOllamaModels[0]);
      }
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
      if (rawErDiagram) {
        const match = rawErDiagram.entities.find((e) => e.filePath === filePath);
        if (match) {
          setSelectedEntityId(match.id);
          setHighlightedColumn(null);
        }
      }
    },
    [rawErDiagram]
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

  // Deep insights: backend result (algorithm or ollama) with instant client-side fallback
  const clientFallbackInsights = useMemo(
    () => computeClientSideInsights(rawGraphData, rawErDiagram),
    [rawGraphData, rawErDiagram]
  );

  const effectiveInsights = backendInsights ?? clientFallbackInsights;

  const {
    graph: graphData,
    fileInsightMap,
    clusterMap,
    violationEdgeKeys,
    violationMap,
  } = useMemo(
    () => applyInsightsToGraph(rawGraphData, effectiveInsights),
    [rawGraphData, effectiveInsights]
  );

  const { diagram: erDiagram, inferredById: inferredErMap } = useMemo(
    () => applyInsightsToErDiagram(rawErDiagram, effectiveInsights, showInferredEr),
    [rawErDiagram, effectiveInsights, showInferredEr]
  );

  const handleEngineChange = useCallback(
    (nextEngine: InsightEngine) => {
      setInsightEngine(nextEngine);
      if (currentRepo) {
        void loadDeepInsights(currentRepo.id, nextEngine, insightModel, false);
      }
    },
    [currentRepo, insightModel, loadDeepInsights]
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      setInsightModel(nextModel);
      if (currentRepo && insightEngine === 'ollama') {
        void loadDeepInsights(currentRepo.id, 'ollama', nextModel, false);
      }
    },
    [currentRepo, insightEngine, loadDeepInsights]
  );

  const handleRefreshInsights = useCallback(() => {
    if (currentRepo) {
      void loadDeepInsights(currentRepo.id, insightEngine, insightModel, true);
    }
  }, [currentRepo, insightEngine, insightModel, loadDeepInsights]);

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

  // Searching for a file/function or isolating a module cluster switches to the detailed map.
  const effectiveMapMode: 'overview' | 'detail' =
    fileSearch.trim() || activeClusterId !== null ? 'detail' : mapMode;
  const edgeCount = graphData?.edges.length ?? 0;
  const effectiveShowAllEdges = showAllEdges ?? edgeCount <= AUTO_SHOW_ALL_EDGES_LIMIT;

  const { flowNodes, flowEdges, visibleCount, focusNodeIds } = useMemo(() => {
    if (!graphData) {
      return {
        flowNodes: [] as Node[],
        flowEdges: [] as Edge[],
        visibleCount: 0,
        focusNodeIds: undefined as { id: string }[] | undefined,
      };
    }

    const query = fileSearch.trim().toLowerCase();
    const visible = graphData.nodes
      .filter((n) => {
        const fi = fileInsightMap.get(n.path);
        const effRole = fi?.role ?? refineArchitecturalRole(n.path, n.architecturalRole, n.language);
        if (roleFilter !== 'ALL' && effRole !== roleFilter) return false;
        if (activeClusterId !== null && fi && fi.clusterId !== activeClusterId) return false;
        return true;
      })
      .filter(
        (n) =>
          !query ||
          n.path.toLowerCase().includes(query) ||
          n.symbols.some((s) => s.toLowerCase().includes(query))
      );

    // ---- Big picture: one card per layer, one arrow per pair of layers ----
    if (effectiveMapMode === 'overview') {
      const ov = layoutOverview(visible, graphData.edges);
      const layerTitle = new Map(ov.layers.map((l) => [l.id, l.title]));
      const selectedLayerId = selectedFilePath ? ov.layerOfNode.get(selectedFilePath) : undefined;

      const usesByLayer = new Map<string, { title: string; count: number }[]>();
      for (const link of ov.links) {
        const list = usesByLayer.get(link.source) ?? [];
        list.push({ title: layerTitle.get(link.target) ?? '', count: link.count });
        usesByLayer.set(link.source, list);
      }

      const citedByLayer = new Map<string, number>();
      for (const n of visible) {
        if (!citedFileMap.has(n.path)) continue;
        const layerId = ov.layerOfNode.get(n.id);
        if (layerId) citedByLayer.set(layerId, (citedByLayer.get(layerId) ?? 0) + 1);
      }

      const layerNodes: Node[] = ov.layers.map((layer) => {
        const data: LayerSummaryNodeData = {
          step: layer.step,
          title: layer.title,
          subtitle: layer.subtitle,
          color: layer.color,
          count: layer.count,
          roleBadges: layer.roleBadges,
          topFiles: layer.topFiles,
          internalLinks: layer.internalLinks,
          usesLayers: usesByLayer.get(layer.id) ?? [],
          citedCount: citedByLayer.get(layer.id) ?? 0,
          containsSelected: layer.id === selectedLayerId,
          selectedLabel: selectedGraphNode?.label,
          width: OVERVIEW_NODE_WIDTH,
          height: OVERVIEW_NODE_HEIGHT,
        };
        return {
          id: layer.id,
          type: 'layerSummary',
          position: { x: layer.x, y: layer.y },
          data,
          draggable: false,
        };
      });

      const layerEdges: Edge[] = ov.links.map((link) => {
        const isApi = link.apiCalls > 0 && link.apiCalls === link.count;
        const fromSelected = link.source === selectedLayerId;
        const intoSelected = link.target === selectedLayerId;
        const hasLayerFocus = !!selectedLayerId;
        const highlighted = fromSelected || intoSelected;

        const color = fromSelected
          ? isDark
            ? '#818cf8'
            : '#4f46e5'
          : intoSelected
          ? isDark
            ? '#34d399'
            : '#059669'
          : isApi
          ? isDark
            ? '#ec4899'
            : '#db2777'
          : isDark
          ? '#64748b'
          : '#94a3b8';

        let sourceSide: string;
        let targetSide: string;
        if (link.skipsLayers) {
          sourceSide = link.upward ? 'left' : 'right';
          targetSide = sourceSide;
        } else if (link.upward) {
          sourceSide = 'top';
          targetSide = 'bottom';
        } else {
          sourceSide = 'bottom';
          targetSide = 'top';
        }

        const noun = link.count === 1 ? 'link' : 'links';
        const label = isApi
          ? `calls API · ${link.count} ${noun}`
          : link.upward
          ? `${link.count} ${noun} (points back up)`
          : `${link.count} ${noun}`;

        return {
          id: link.id,
          source: link.source,
          target: link.target,
          sourceHandle: `${sourceSide}-source`,
          targetHandle: `${targetSide}-target`,
          type: 'smoothstep',
          pathOptions: link.skipsLayers
            ? { offset: 36 + link.skipIndex * 24, borderRadius: 18 }
            : { borderRadius: 18 },
          label,
          animated: highlighted,
          labelStyle: {
            fill: isDark ? '#e2e8f0' : '#0f172a',
            fontSize: 11,
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: isDark ? '#0f172a' : '#ffffff',
            fillOpacity: 0.95,
          },
          labelBgPadding: [8, 4] as [number, number],
          labelBgBorderRadius: 6,
          style: {
            stroke: color,
            strokeWidth: Math.min(5, 1.8 + Math.log2(link.count + 1) * 0.7),
            strokeDasharray: isApi ? '6 4' : undefined,
            opacity: hasLayerFocus && !highlighted ? 0.45 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        } as Edge;
      });

      return {
        flowNodes: layerNodes,
        flowEdges: layerEdges,
        visibleCount: visible.length,
        focusNodeIds: undefined as { id: string }[] | undefined,
      };
    }

    // ---- Detail: every file, grouped in layer lanes ----
    const layout = layoutGraph(visible, graphData.edges);
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
        step: lane.step,
        title: lane.title,
        subtitle: lane.subtitle,
        color: lane.color,
        count: lane.count,
        roleBadges: lane.roleBadges,
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
      const fi = fileInsightMap.get(n.path);
      const cluster = fi ? clusterMap.get(fi.clusterId) : undefined;

      const data: ArchNodeData = {
        path: n.path,
        label: n.label,
        directory: n.directory,
        language: n.language,
        architecturalRole: fi?.role ?? refineArchitecturalRole(n.path, n.architecturalRole, n.language),
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
        deepSummary: fi?.summary,
        confidence: fi?.confidence,
        importance: fi?.importance,
        clusterName: cluster?.name,
        clusterColor: fi ? getClusterColor(fi.clusterId) : undefined,
        inCycle: fi?.inCycle,
        reasons: fi?.reasons,
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
      .flatMap((e): Edge[] => {
        const sourcePos = layout.positions.get(e.source) ?? { x: 0, y: 0 };
        const targetPos = layout.positions.get(e.target) ?? { x: 0, y: 0 };
        const { sourceSide, targetSide } = archEdgeSides(
          sourcePos,
          targetPos,
          layout.rows.get(e.source) ?? 0,
          layout.rows.get(e.target) ?? 0
        );

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

        const edgeKey = `${e.source}->${e.target}`;
        const isViolation = violationEdgeKeys.has(edgeKey);
        const isConnected =
          isDirectOutgoing || isDirectIncoming || isDownstreamChain || isUpstreamChain || isViolation;
        const isApiCall = e.relationType === 'API_CALL';

        // On big repos, hide arrows that are not tied to the selected file to avoid a hairball.
        if (!effectiveShowAllEdges && hasFocus && !isConnected) return [];

        const color = isViolation
          ? '#f43f5e'
          : isDownstreamChain
          ? isDirectIncoming
            ? isDark
              ? '#fb7185'
              : '#e11d48'
            : isDark
            ? '#f59e0b'
            : '#d97706'
          : isDirectIncoming
          ? isDark
            ? '#34d399'
            : '#059669'
          : isDirectOutgoing || isUpstreamChain
          ? isDark
            ? '#818cf8'
            : '#4f46e5'
          : isApiCall
          ? isDark
            ? '#ec4899'
            : '#db2777'
          : isDark
          ? '#475569'
          : '#94a3b8';

        return [
          {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: `${sourceSide}-source`,
            targetHandle: `${targetSide}-target`,
            type: 'smoothstep',
            label: isViolation
              ? '⚠ layer violation'
              : isConnected
              ? relationLabel(e.relationType)
              : undefined,
            animated: isConnected,
            labelStyle: {
              fill: isViolation ? '#fda4af' : isDark ? '#e2e8f0' : '#0f172a',
              fontSize: 10,
              fontWeight: 600,
            },
            labelBgStyle: {
              fill: isDark ? '#0f172a' : '#ffffff',
              fillOpacity: 0.92,
            },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 4,
            style: {
              stroke: color,
              strokeWidth: isConnected ? 2.4 : 1.4,
              strokeDasharray: isApiCall || isViolation ? '6 4' : undefined,
              opacity: hasFocus && !isConnected ? 0.25 : 1,
            },
            markerEnd: { type: MarkerType.ArrowClosed, color },
          },
        ];
      });

    // When a layer was opened from the overview, zoom the camera to that lane.
    let detailFocus: { id: string }[] | undefined;
    if (focusLayerId && layout.lanes.some((l) => l.id === focusLayerId)) {
      detailFocus = [
        { id: focusLayerId },
        ...visible
          .filter((n) => `lane-${resolveNodeLayerKey(n)}` === focusLayerId)
          .map((n) => ({ id: n.id })),
      ];
    }

    return {
      flowNodes: [...laneNodes, ...archNodes],
      flowEdges: edges,
      visibleCount: visible.length,
      focusNodeIds: detailFocus,
    };
  }, [
    graphData,
    fileInsightMap,
    clusterMap,
    violationEdgeKeys,
    activeClusterId,
    roleFilter,
    fileSearch,
    selectedFilePath,
    selectedGraphNode,
    impactReport,
    impactMode,
    citedFileMap,
    isDark,
    effectiveMapMode,
    effectiveShowAllEdges,
    focusLayerId,
  ]);

  const visibleFileCount = visibleCount;

  const openLayerDetail = useCallback((layerId: string | null) => {
    setFocusLayerId(layerId);
    setMapMode('detail');
  }, []);

  const showOverview = useCallback(() => {
    setFocusLayerId(null);
    setMapMode('overview');
    setFileSearch('');
  }, []);

  const filteredFiles = useMemo(() => {
    return files
      .filter(
        (f) =>
          roleFilter === 'ALL' ||
          refineArchitecturalRole(f.path, f.architecturalRole, f.language) === roleFilter
      )
      .filter(
        (f) =>
          !fileSearch.trim() ||
          f.path.toLowerCase().includes(fileSearch.trim().toLowerCase())
      );
  }, [files, roleFilter, fileSearch]);

  const refinedRoleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!graphData) return counts;
    for (const n of graphData.nodes) {
      const r = refineArchitecturalRole(n.path, n.architecturalRole, n.language);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }, [graphData]);

  const availableRoles = useMemo(() => {
    return Object.keys(refinedRoleCounts);
  }, [refinedRoleCounts]);

  const languages = useMemo(
    () => (graphData ? Object.keys(graphData.languageCounts) : []),
    [graphData]
  );

  const erTableCount = erDiagram?.entities.length ?? 0;
  const erRelationCount = erDiagram?.relations.length ?? 0;

  const showWelcome = !booting && repos.length === 0 && !currentRepo;

  const canDropToSideBox =
    draggingPane !== null && (mainPanes.length > 1 || Boolean(sideBoxes[draggingPane]));

  const dockedSideEntries = useMemo(
    () =>
      paneOrder
        .filter((id) => Boolean(sideBoxes[id]))
        .map((id) => ({ paneId: id, config: sideBoxes[id]! })),
    [paneOrder, sideBoxes]
  );

  const renderPaneContent = (
    paneId: PaneId,
    stepNumber: number,
    dragHandlers?: PaneDragHandlers
  ) => {
    if (paneId === 'map') {
      return (
        <>
          <PaneHeader
            step={stepNumber}
            title={
              leftView === 'er'
                ? 'Database ER diagram'
                : leftView === '3d'
                ? '3D Relational Architecture & DB'
                : 'Architecture & Impact'
            }
            subtitle={
              leftView === 'er'
                ? 'Tables, columns, primary/foreign keys and AI/algorithm inferred relationships'
                : leftView === '3d'
                ? 'Interactive Three.js 3D layers, module clusters, request flow pulse & database tables'
                : impactMode
                ? 'Blast radius: highlighting every file affected if the selected file changes'
                : effectiveMapMode === 'overview'
                ? 'Big picture: how a request travels through the layers of the app'
                : 'Layers of the app and how its files depend on each other'
            }
            drag={dragHandlers}
            actions={
              leftView !== 'tree' ? (
                <div className="flex items-center gap-1.5">
                  {(leftView === 'graph' || leftView === '3d') && (
                    <button
                      onClick={() => setImpactMode((v) => !v)}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                        impactMode
                          ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-amber-500/50 hover:text-slate-100'
                      }`}
                      title="Toggle multi-hop Impact Analysis (blast radius) on the map"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      Impact
                    </button>
                  )}
                  <button
                    onClick={() => setGraphExpanded((v) => !v)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-slate-100"
                    title={
                      graphExpanded
                        ? 'Back to the three-panel view'
                        : 'Make the diagram fill the screen'
                    }
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
                    <strong className="text-slate-200">{erRelationCount}</strong> foreign-key
                    relations
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
                    Languages:{' '}
                    <strong className="text-slate-200">{languages.join(', ') || '—'}</strong>
                  </span>
                </>
              )}
            </div>
          )}

          {/* Deep Architecture & ER Intelligence Bar (Algorithm | Ollama AI Local) */}
          <DeepInsightsBar
            insights={effectiveInsights}
            engine={insightEngine}
            selectedModel={insightModel}
            loading={loadingInsights}
            systemStatus={systemStatus}
            activeClusterId={activeClusterId}
            showInferredEr={showInferredEr}
            onChangeEngine={handleEngineChange}
            onChangeModel={handleModelChange}
            onRefresh={handleRefreshInsights}
            onSelectCluster={setActiveClusterId}
            onToggleInferredEr={() => setShowInferredEr((v) => !v)}
            onSelectFile={handleNavigateToFile}
            onSelectEntityById={(entityId) => {
              const found = erDiagram?.entities.find((e) => e.id === entityId);
              if (found) {
                setLeftView('er');
                handleSelectEntity(found);
              }
            }}
          />

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
                onClick={() => setLeftView('3d')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                  leftView === '3d'
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Interactive Three.js 3D Relational Architecture, Module Clusters & Database ER Explorer"
              >
                <Box className="h-3.5 w-3.5" />
                3D Relational
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
                      {getRoleMeta(role).label} ({refinedRoleCounts[role]})
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
                <MapLegend mode={effectiveMapMode} />
                {/* Map navigation: big picture <-> files, jump to a layer, arrow visibility */}
                <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-6.5rem)] flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex rounded-lg border border-slate-700 bg-slate-900/95 p-0.5 text-[11px] shadow-lg">
                      <button
                        onClick={showOverview}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition ${
                          effectiveMapMode === 'overview'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="One card per layer, with arrows showing how the layers talk"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        Big picture
                      </button>
                      <button
                        onClick={() => openLayerDetail(null)}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition ${
                          effectiveMapMode === 'detail'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Every file, grouped by layer"
                      >
                        <Network className="h-3.5 w-3.5" />
                        All files
                      </button>
                    </div>
                    {effectiveMapMode === 'detail' && edgeCount > AUTO_SHOW_ALL_EDGES_LIMIT && (
                      <button
                        onClick={() => setShowAllEdges(!effectiveShowAllEdges)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/95 px-2 py-1.5 text-[11px] font-medium text-slate-300 shadow-lg transition hover:border-indigo-500/60 hover:text-slate-100"
                        title={
                          effectiveShowAllEdges
                            ? 'Hide arrows that are not connected to the selected file'
                            : 'Show every arrow between files'
                        }
                      >
                        {effectiveShowAllEdges ? (
                          <Eye className="h-3.5 w-3.5 text-indigo-300" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                        )}
                        {effectiveShowAllEdges
                          ? `All ${edgeCount} arrows`
                          : 'Selected file only'}
                      </button>
                    )}
                  </div>
                  {effectiveMapMode === 'detail' && graphData && (
                    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 p-1 shadow-lg">
                      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Jump to
                      </span>
                      {LAYERS.filter((l) =>
                        graphData.nodes.some((n) => resolveNodeLayerKey(n) === l.key)
                      ).map((l) => {
                        const laneId = `lane-${l.key}`;
                        const active = focusLayerId === laneId;
                        return (
                          <button
                            key={l.key}
                            onClick={() => openLayerDetail(laneId)}
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold transition hover:brightness-125"
                            style={{
                              backgroundColor: `${l.color}${active ? '44' : '1f'}`,
                              color: l.color,
                              boxShadow: active ? `inset 0 0 0 1px ${l.color}` : undefined,
                            }}
                          >
                            {getLayerMeta(l.key).title}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {visibleFileCount === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-400">
                    <Network className="mb-2 h-8 w-8 text-slate-700" />
                    <p className="text-sm font-medium text-slate-300">No files match your filter</p>
                    <p className="mt-1 text-xs">Clear the search box or choose “All types”.</p>
                  </div>
                ) : (
                  <ReactFlow
                    key={`${currentRepo?.id}-${roleFilter}-${visibleFileCount}-${graphExpanded}-${effectiveMapMode}-${focusLayerId ?? 'all'}`}
                    colorMode={theme}
                    nodes={flowNodes}
                    edges={flowEdges}
                    nodeTypes={nodeTypes}
                    onNodeClick={(_, node) => {
                      if (node.type === 'lane') return;
                      if (node.type === 'layerSummary') {
                        openLayerDetail(node.id);
                        return;
                      }
                      handleNavigateToFile(node.id);
                    }}
                    nodesConnectable={false}
                    fitView
                    fitViewOptions={{ padding: 0.12, nodes: focusNodeIds }}
                    minZoom={0.15}
                    maxZoom={1.6}
                  >
                    <Background color={isDark ? '#1e293b' : '#cbd5e1'} gap={22} />
                    <Controls
                      showInteractive={false}
                      className="!border-slate-700 !bg-slate-900 !text-slate-200"
                    />
                    {graphExpanded && (
                      <MiniMap
                        nodeColor={(n) =>
                          n.type === 'lane'
                            ? 'transparent'
                            : n.type === 'layerSummary'
                            ? String((n.data as LayerSummaryNodeData).color)
                            : citedFileMap.has(n.id)
                            ? '#10b981'
                            : n.id === selectedFilePath
                            ? '#6366f1'
                            : isDark
                            ? '#334155'
                            : '#94a3b8'
                        }
                        maskColor={
                          isDark ? 'rgba(2, 6, 23, 0.75)' : 'rgba(226, 232, 240, 0.75)'
                        }
                        className="!rounded-lg !border !border-slate-800 !bg-slate-900/90"
                      />
                    )}
                  </ReactFlow>
                )}
              </>
            ) : leftView === '3d' ? (
              <Relational3DView
                graphData={graphData}
                erDiagram={erDiagram}
                fileInsightMap={fileInsightMap}
                clusterMap={clusterMap}
                violationEdgeKeys={violationEdgeKeys}
                violationMap={violationMap}
                inferredErMap={inferredErMap}
                citedFileMap={citedFileMap}
                impactReport={impactReport}
                impactMode={impactMode}
                selectedFilePath={selectedFilePath}
                selectedEntityId={selectedEntityId}
                activeClusterId={activeClusterId}
                query={fileSearch}
                roleFilter={roleFilter}
                onSelectFile={handleNavigateToFile}
                onSelectEntity={handleSelectEntity}
              />
            ) : leftView === 'er' ? (
              <ErDiagramView
                diagram={erDiagram}
                inferredById={inferredErMap}
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
                  <p className="p-6 text-center text-xs text-slate-500">
                    No files match your filter.
                  </p>
                )}
                {filteredFiles.map((f) => {
                  const isSelected = f.path === selectedFilePath;
                  const isCited = citedFileMap.has(f.path);
                  const fi = fileInsightMap.get(f.path);
                  const role = getRoleMeta(
                    fi?.role ?? refineArchitecturalRole(f.path, f.architecturalRole, f.language)
                  );
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
                            <span
                              className={`rounded border px-1.5 py-0.5 font-semibold ${role.badge}`}
                            >
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

          {/* Bottom context card */}
          {leftView === 'er' && selectedErEntity && erDiagram ? (
            <ErEntitySummaryCard
              entity={selectedErEntity}
              diagram={erDiagram}
              inferredById={inferredErMap}
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
        </>
      );
    }

    if (paneId === 'code') {
      return (
        <>
          <PaneHeader
            step={stepNumber}
            title="Source code"
            subtitle={
              codeFullscreen
                ? 'Full screen · press Esc to exit'
                : 'The real file, with exact line numbers'
            }
            drag={codeFullscreen ? undefined : dragHandlers}
            actions={
              <button
                onClick={() => setCodeFullscreen((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-slate-100"
                title={
                  codeFullscreen ? 'Exit full screen (Esc)' : 'View the code in full screen'
                }
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
        </>
      );
    }

    return (
      <CitedAiPanel
        step={stepNumber}
        drag={dragHandlers}
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
    );
  };

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

          {!showWelcome && isLayoutCustomized && (
            <button
              type="button"
              onClick={handleResetLayout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-slate-100"
              title="Reset panels to default order (1. Architecture → 2. Source code → 3. Ask the AI), widths, and close Side Boxes"
            >
              <RotateCcw className="h-3.5 w-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Reset layout</span>
            </button>
          )}

          <ThemeToggle />

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
            className="text-[11px] text-rose-300 underline hover:text-slate-100"
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
        <main ref={workspaceRef} className="relative flex flex-1 overflow-hidden">
          {/* Left & Right Side Box Drop Zones when dragging a panel */}
          {canDropToSideBox && (
            <>
              <div
                onDragOver={(e) => handleSideZoneDragOver(e, 'left')}
                onDragLeave={() => {
                  if (dragOverSideZone === 'left') setDragOverSideZone(null);
                }}
                onDrop={(e) => handleSideZoneDrop(e, 'left')}
                className={`vr-side-dropzone absolute bottom-3 left-2.5 top-3 z-50 flex w-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-3 text-center ${
                  dragOverSideZone === 'left' ? 'vr-side-dropzone-active' : ''
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-400/50 bg-indigo-500/20 text-indigo-300 shadow-lg">
                  <PictureInPicture2 className="h-4 w-4" />
                </div>
                <span className="text-[11px] font-bold tracking-tight text-slate-100">
                  Left Side Box
                </span>
                <span className="text-[10px] leading-tight text-slate-300">
                  Drop{' '}
                  <strong className="text-indigo-300">
                    {draggingPane ? PANE_LABELS[draggingPane] : 'panel'}
                  </strong>{' '}
                  here to dock on left
                </span>
              </div>

              <div
                onDragOver={(e) => handleSideZoneDragOver(e, 'right')}
                onDragLeave={() => {
                  if (dragOverSideZone === 'right') setDragOverSideZone(null);
                }}
                onDrop={(e) => handleSideZoneDrop(e, 'right')}
                className={`vr-side-dropzone absolute bottom-3 right-2.5 top-3 z-50 flex w-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-3 text-center ${
                  dragOverSideZone === 'right' ? 'vr-side-dropzone-active' : ''
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-400/50 bg-indigo-500/20 text-indigo-300 shadow-lg">
                  <PictureInPicture2 className="h-4 w-4" />
                </div>
                <span className="text-[11px] font-bold tracking-tight text-slate-100">
                  Right Side Box
                </span>
                <span className="text-[10px] leading-tight text-slate-300">
                  Drop{' '}
                  <strong className="text-indigo-300">
                    {draggingPane ? PANE_LABELS[draggingPane] : 'panel'}
                  </strong>{' '}
                  here to dock on right
                </span>
              </div>
            </>
          )}

          {/* Main Workspace Columns */}
          {mainPanes.map((paneId, slotIdx) => {
            const stepNumber = paneOrder.indexOf(paneId) + 1;
            const isDraggingThis = draggingPane === paneId;
            const isDropTarget = dragOverPane === paneId && draggingPane !== paneId;
            const isSettled = settledPanes.includes(paneId);

            const dragHandlers: PaneDragHandlers = {
              paneId,
              canMoveLeft: slotIdx > 0,
              canMoveRight: slotIdx < mainPanes.length - 1,
              canDockSide: mainPanes.length > 1,
              isDragging: isDraggingThis,
              onMoveLeft: () => handleMovePaneByOffset(paneId, -1),
              onMoveRight: () => handleMovePaneByOffset(paneId, 1),
              onDockSide: () =>
                dockPaneToSideBox(paneId, slotIdx === 0 ? 'left' : 'right'),
              onDragStart: handlePaneDragStart,
              onDragEnd: handlePaneDragEnd,
            };

            const isHiddenByExpand = graphExpanded && paneId !== 'map';
            const isFullWidthMap = graphExpanded && paneId === 'map';
            const isFullscreenCode = codeFullscreen && paneId === 'code';

            const sectionWidthStyle =
              isFullscreenCode || isHiddenByExpand
                ? undefined
                : {
                    width: isFullWidthMap
                      ? '100%'
                      : `${normalizedMainWidths[paneId]}%`,
                  };

            const dropOverlay = isDropTarget && draggingPane && (
              <div className="vr-drop-overlay pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed backdrop-blur-[2px]">
                <div className="vr-drop-pill flex items-center gap-2 rounded-xl border border-indigo-400/60 bg-slate-900/95 px-4 py-2.5 text-xs font-semibold text-slate-100 shadow-2xl">
                  <ArrowLeftRight className="h-4 w-4 text-indigo-400" />
                  <span>
                    {sideBoxes[draggingPane] ? (
                      <>
                        Restore <strong>{PANE_LABELS[draggingPane]}</strong> into main columns
                      </>
                    ) : (
                      <>
                        Swap <strong>{PANE_LABELS[draggingPane]}</strong> ⇄{' '}
                        <strong>{PANE_LABELS[paneId]}</strong>
                      </>
                    )}
                  </span>
                </div>
              </div>
            );

            return (
              <Fragment key={paneId}>
                <section
                  ref={(el) => {
                    paneRefs.current[paneId] = el;
                  }}
                  style={sectionWidthStyle}
                  onDragOver={(e) => handlePaneDragOver(e, paneId)}
                  onDragLeave={() => {
                    if (dragOverPane === paneId) setDragOverPane(null);
                  }}
                  onDrop={(e) => handlePaneDrop(e, paneId)}
                  className={
                    isFullscreenCode
                      ? 'fixed inset-0 z-40 flex flex-col overflow-hidden bg-slate-950'
                      : `vr-pane relative flex-col overflow-hidden border-r border-slate-800 ${
                          isHiddenByExpand ? 'hidden' : 'flex'
                        } ${isDraggingThis ? 'vr-pane-dragging' : ''} ${
                          isSettled ? 'vr-pane-settled' : ''
                        }`
                  }
                >
                  {dropOverlay}
                  {renderPaneContent(paneId, stepNumber, dragHandlers)}
                </section>

                {!graphExpanded && slotIdx < mainPanes.length - 1 && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize panels"
                    title="Drag to resize panels · Double-click to reset widths"
                    onMouseDown={(e) => startResizeSplit(e, slotIdx)}
                    onDoubleClick={() => setPaneWidths(DEFAULT_PANE_WIDTHS)}
                    className={`vr-pane-resizer ${
                      activeResizer === slotIdx ? 'vr-pane-resizer-active' : ''
                    }`}
                  />
                )}
              </Fragment>
            );
          })}

          {/* Docked Left / Right Side Boxes */}
          {dockedSideEntries.map(({ paneId, config }) => {
            const stepNumber = paneOrder.indexOf(paneId) + 1;
            const isLeft = config.side === 'left';
            const sameSideBeforeCount = dockedSideEntries
              .filter((e) => e.config.side === config.side)
              .findIndex((e) => e.paneId === paneId);

            if (config.minimized) {
              const topOffset = 16 + sameSideBeforeCount * 62;
              return (
                <div
                  key={`sidebox-pill-${paneId}`}
                  draggable
                  onDragStart={(e) => handlePaneDragStart(e, paneId)}
                  onDragEnd={handlePaneDragEnd}
                  style={{ top: `${topOffset}px` }}
                  className={`vr-sidebox-pill absolute z-40 flex items-center gap-2 rounded-2xl border border-indigo-500/50 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 backdrop-blur-md transition hover:border-indigo-400 ${
                    isLeft ? 'left-3' : 'right-3'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSideBoxMinimized(paneId)}
                    className="flex items-center gap-2 text-left"
                    title={`Expand ${PANE_LABELS[paneId]} Side Box`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/25 text-[11px] font-bold text-indigo-300 ring-1 ring-indigo-500/40">
                      {stepNumber}
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                        <PictureInPicture2 className="h-3.5 w-3.5 text-indigo-400" />
                        <span>{PANE_LABELS[paneId]}</span>
                      </div>
                      <span className="block text-[10px] text-slate-400">
                        {isLeft ? 'Left' : 'Right'} Side Box · Click to open
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => undockSideBoxToMain(paneId)}
                    className="ml-1 rounded-lg border border-slate-700 bg-slate-950/90 p-1.5 text-slate-300 transition hover:border-indigo-500/60 hover:text-slate-100"
                    title="Restore back to main columns"
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            }

            return (
              <aside
                key={`sidebox-${paneId}`}
                style={
                  sameSideBeforeCount > 0
                    ? {
                        transform: `translateY(${sameSideBeforeCount * 18}px)`,
                      }
                    : undefined
                }
                className={`absolute bottom-3 top-3 z-40 flex w-[430px] max-w-[46vw] flex-col overflow-hidden rounded-2xl border border-indigo-500/45 bg-slate-950/95 backdrop-blur-md ${
                  isLeft ? 'vr-sidebox-left left-3' : 'vr-sidebox-right right-3'
                }`}
              >
                {/* Side Box Control Bar (Draggable back to main columns or opposite side) */}
                <div
                  draggable
                  onDragStart={(e) => handlePaneDragStart(e, paneId)}
                  onDragEnd={handlePaneDragEnd}
                  title="Drag this Side Box onto any main panel to restore it, or to the opposite edge to flip sides"
                  className="flex cursor-grab items-center justify-between gap-2 border-b border-indigo-500/30 bg-gradient-to-r from-indigo-950/80 via-slate-900/95 to-slate-900/95 px-3 py-1.5 active:cursor-grabbing"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md border border-indigo-400/40 bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-200">
                      <PictureInPicture2 className="h-3 w-3 text-indigo-300" />
                      {isLeft ? 'Left Side Box' : 'Right Side Box'}
                    </span>
                    <span className="hidden text-[10px] text-slate-400 sm:inline">
                      Drag to main columns or opposite side
                    </span>
                  </div>

                  <div
                    className="flex items-center gap-1"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => flipSideBoxSide(paneId)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-950/80 px-1.5 py-1 text-[10px] font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-slate-100"
                      title={
                        isLeft ? 'Move Side Box to the right side' : 'Move Side Box to the left side'
                      }
                    >
                      {isLeft ? (
                        <>
                          <span>Right</span>
                          <ChevronRight className="h-3 w-3" />
                        </>
                      ) : (
                        <>
                          <ChevronLeft className="h-3 w-3" />
                          <span>Left</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleSideBoxMinimized(paneId)}
                      className="inline-flex items-center justify-center rounded-md border border-slate-700/80 bg-slate-950/80 p-1 text-slate-300 transition hover:border-indigo-500/60 hover:text-slate-100"
                      title="Minimize Side Box into a compact side pill"
                    >
                      <Minus className="h-3 w-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => undockSideBoxToMain(paneId)}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[10px] font-semibold text-indigo-200 transition hover:border-indigo-400 hover:bg-indigo-500/25"
                      title="Dock back into the main columns"
                    >
                      <Columns3 className="h-3 w-3" />
                      <span>Dock back</span>
                    </button>
                  </div>
                </div>

                {/* Live Panel Content inside Side Box */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {renderPaneContent(paneId, stepNumber, undefined)}
                </div>
              </aside>
            );
          })}
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
