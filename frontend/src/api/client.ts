import type {
  ArchitectureGraph,
  CitedAnswerResponse,
  ErDiagram,
  RepositorySummary,
  SourceFileDetail,
  SourceFileSummary,
  SystemStatus,
} from '../types/api';

const API_BASE = '/api';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody && errBody.error) {
        errorMessage = errBody.error;
      }
    } catch {
      // ignore parse error
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

export const apiClient = {
  getSystemStatus: () => requestJson<SystemStatus>('/system/status'),

  listRepositories: () => requestJson<RepositorySummary[]>('/repos'),

  indexRepository: (repoUrlOrFullName: string, branch?: string, generateEmbeddingsImmediately = false) =>
    requestJson<RepositorySummary>('/repos/index', {
      method: 'POST',
      body: JSON.stringify({
        repoUrlOrFullName,
        branch: branch || null,
        generateEmbeddingsImmediately,
      }),
    }),

  generateEmbeddings: (repoId: number) =>
    requestJson<RepositorySummary>(`/repos/${repoId}/embeddings`, {
      method: 'POST',
    }),

  deleteRepository: (repoId: number) =>
    requestJson<void>(`/repos/${repoId}`, {
      method: 'DELETE',
    }),

  listFiles: (repoId: number) => requestJson<SourceFileSummary[]>(`/repos/${repoId}/files`),

  getFileContent: (repoId: number, path: string) =>
    requestJson<SourceFileDetail>(`/repos/${repoId}/files/content?path=${encodeURIComponent(path)}`),

  getArchitectureGraph: (repoId: number) =>
    requestJson<ArchitectureGraph>(`/repos/${repoId}/graph`),

  getErDiagram: (repoId: number) =>
    requestJson<ErDiagram>(`/repos/${repoId}/er-diagram`),

  askQuestion: (
    repoId: number,
    question: string,
    retrievalMode?: string,
    modelOverride?: string
  ) =>
    requestJson<CitedAnswerResponse>(`/repos/${repoId}/ask`, {
      method: 'POST',
      body: JSON.stringify({
        question,
        retrievalMode: retrievalMode || null,
        modelOverride: modelOverride || null,
      }),
    }),

  getAnalysisHistory: (repoId: number) =>
    requestJson<CitedAnswerResponse[]>(`/repos/${repoId}/history`),
};
