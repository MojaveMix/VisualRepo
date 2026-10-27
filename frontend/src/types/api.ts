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
