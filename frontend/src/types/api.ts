export type IndexingStatus = 'PENDING' | 'INDEXING' | 'INDEXED' | 'EMBEDDING' | 'READY' | 'FAILED';
export type RetrievalMode = 'BASIC_INDEX' | 'VECTOR_HYBRID';

export interface RepositorySummary {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string;
  commitSha: string;
  htmlUrl: string;
  description: string;
  status: IndexingStatus;
  embeddingsGenerated: boolean;
  embeddingModel?: string | null;
  fileCount: number;
  chunkCount: number;
  edgeCount: number;
  errorMessage?: string | null;
  createdAt: string;
  lastIndexedAt?: string | null;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
}

export interface SourceFileSummary {
  id: number;
  path: string;
  language: string;
  architecturalRole: string;
  lineCount: number;
  sizeBytes: number;
  symbolCount: number;
  importCount: number;
}

export interface SourceFileDetail {
  id: number;
  path: string;
  language: string;
  architecturalRole: string;
  lineCount: number;
  sizeBytes: number;
  content: string;
  imports: string[];
  symbols: SymbolInfo[];
  outgoingDependencies: string[];
  incomingDependents: string[];
  githubBlobUrl: string;
}

export interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string;
  reason: string;
  snippet: string;
  githubBlobUrl: string;
}

export interface CitedAnswerResponse {
  historyId: number;
  question: string;
  answer: string;
  architecturalSummary: string;
  citations: Citation[];
  modelUsed: string;
  retrievalMode: RetrievalMode;
  createdAt: string;
}

export interface GraphNodeDto {
  id: string;
  path: string;
  label: string;
  directory: string;
  language: string;
  architecturalRole: string;
  tier: string;
  lineCount: number;
  symbols: string[];
  incomingCount: number;
  outgoingCount: number;
  x: number;
  y: number;
}

export interface GraphEdgeDto {
  id: string;
  source: string;
  target: string;
  relationType: string;
  targetSymbol?: string;
}

export interface ArchitectureGraph {
  repositoryId: number;
  repoFullName: string;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  roleCounts: Record<string, number>;
  languageCounts: Record<string, number>;
}

export interface SystemStatus {
  databaseMode: string;
  ollamaOnline: boolean;
  configuredChatModel: string;
  configuredEmbedModel: string;
  availableOllamaModels: string[];
  githubTokenConfigured: boolean;
}

export type ErRelationType = 'MANY_TO_ONE' | 'ONE_TO_MANY' | 'ONE_TO_ONE' | 'MANY_TO_MANY';

export interface ErColumn {
  name: string;
  fieldName: string;
  javaType: string;
  sqlType: string;
  primaryKey: boolean;
  foreignKey: boolean;
  nullable: boolean;
  unique: boolean;
  references?: string | null;
  filePath: string;
  line: number;
}

export interface ErEntity {
  id: string;
  className: string;
  tableName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  columns: ErColumn[];
}

export interface ErRelation {
  id: string;
  source: string;
  target: string;
  type: ErRelationType;
  fieldName: string;
  joinColumn?: string | null;
  joinTable?: string | null;
}

export interface ErDiagram {
  repositoryId: number;
  repoFullName: string;
  entities: ErEntity[];
  relations: ErRelation[];
}

// ---------------------------------------------------------------------------
// Deep project insights (GET /api/repos/{id}/insights?engine=algorithm|ollama)
// ---------------------------------------------------------------------------

export type InsightEngine = 'algorithm' | 'ollama';

export interface FileInsightDto {
  path: string;
  /** Refined role: UI_COMPONENT | API_CLIENT | CONTROLLER | SERVICE | REPOSITORY | MODEL | MODULE | CONFIG | TEST */
  role: string;
  /** Role assigned at indexing time (heuristic). */
  originalRole: string;
  /** 0..1 confidence of the refined role. */
  confidence: number;
  /** Human-readable evidence behind the refined role. */
  reasons: string[];
  /** One-sentence plain-English purpose of the file. */
  summary: string;
  /** Id of the module cluster (community) this file belongs to. */
  clusterId: number;
  /** PageRank-style importance, normalized to 0..1 (1 = most central file). */
  importance: number;
  /** Topological depth from entry points (0 = entry point). */
  depth: number;
  inCycle: boolean;
  fanIn: number;
  fanOut: number;
}

export interface ModuleClusterDto {
  id: number;
  name: string;
  files: string[];
  /** Ratio of internal edges vs. all edges touching the cluster (0..1). */
  cohesion: number;
  dominantRole: string;
}

export interface DependencyCycleDto {
  files: string[];
}

export interface LayerViolationDto {
  source: string;
  target: string;
  sourceRole: string;
  targetRole: string;
  reason: string;
}

export interface PrunedEdgeDto {
  source: string;
  target: string;
  reason: string;
}

export interface InferredErRelationDto extends ErRelation {
  confidence: number;
  evidence: string;
  /** 'algorithm' | 'ollama' */
  origin: string;
}

export interface ProjectInsights {
  repositoryId: number;
  engine: InsightEngine;
  modelUsed: string;
  aiAvailable: boolean;
  generatedAt: string;
  /** e.g. "Layered (Controller → Service → Repository)", "React SPA + REST backend". */
  architectureStyle: string;
  /** Short multi-sentence description of the project architecture. */
  overview: string;
  files: FileInsightDto[];
  clusters: ModuleClusterDto[];
  cycles: DependencyCycleDto[];
  violations: LayerViolationDto[];
  prunedEdges: PrunedEdgeDto[];
  inferredRelations: InferredErRelationDto[];
  reclassifiedCount: number;
  averageConfidence: number;
  warnings: string[];
}
