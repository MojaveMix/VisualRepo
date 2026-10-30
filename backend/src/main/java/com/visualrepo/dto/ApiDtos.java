package com.visualrepo.dto;

import com.visualrepo.model.IndexingStatus;
import com.visualrepo.model.RetrievalMode;
import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public class ApiDtos {

    public record IndexRepoRequest(
            @NotBlank(message = "Repository URL or owner/name is required")
            String repoUrlOrFullName,
            String branch,
            Boolean generateEmbeddingsImmediately
    ) {}

    public record AskQuestionRequest(
            @NotBlank(message = "Question is required")
            String question,
            String retrievalMode,
            String modelOverride
    ) {}

    public record CitationDto(
            String filePath,
            int startLine,
            int endLine,
            String symbolName,
            String reason,
            String snippet,
            String githubBlobUrl
    ) {}

    public record CitedAnswerResponseDto(
            Long historyId,
            String question,
            String answer,
            String architecturalSummary,
            List<CitationDto> citations,
            String modelUsed,
            RetrievalMode retrievalMode,
            Instant createdAt
    ) {}

    public record RepositorySummaryDto(
            Long id,
            String owner,
            String name,
            String defaultBranch,
            String commitSha,
            String htmlUrl,
            String description,
            IndexingStatus status,
            boolean embeddingsGenerated,
            String embeddingModel,
            int fileCount,
            int chunkCount,
            int edgeCount,
            String errorMessage,
            Instant createdAt,
            Instant lastIndexedAt
    ) {}

    public record SymbolInfoDto(
            String name,
            String kind,
            int startLine,
            int endLine
    ) {}

    public record SourceFileSummaryDto(
            Long id,
            String path,
            String language,
            String architecturalRole,
            int lineCount,
            long sizeBytes,
            int symbolCount,
            int importCount
    ) {}

    public record SourceFileDetailDto(
            Long id,
            String path,
            String language,
            String architecturalRole,
            int lineCount,
            long sizeBytes,
            String content,
            List<String> imports,
            List<SymbolInfoDto> symbols,
            List<String> outgoingDependencies,
            List<String> incomingDependents,
            String githubBlobUrl
    ) {}

    public record GraphNodeDto(
            String id,
            String path,
            String label,
            String directory,
            String language,
            String architecturalRole,
            String tier,
            int lineCount,
            List<String> symbols,
            int incomingCount,
            int outgoingCount,
            double x,
            double y
    ) {}

    public record GraphEdgeDto(
            String id,
            String source,
            String target,
            String relationType,
            String targetSymbol
    ) {}

    public record ArchitectureGraphDto(
            Long repositoryId,
            String repoFullName,
            List<GraphNodeDto> nodes,
            List<GraphEdgeDto> edges,
            Map<String, Integer> roleCounts,
            Map<String, Integer> languageCounts
    ) {}

    public record SystemStatusDto(
            String databaseMode,
            boolean ollamaOnline,
            String configuredChatModel,
            String configuredEmbedModel,
            List<String> availableOllamaModels,
            boolean githubTokenConfigured
    ) {}

    /** One column of a table in the entity-relationship diagram. */
    public record ErColumnDto(
            String name,
            String fieldName,
            String javaType,
            String sqlType,
            boolean primaryKey,
            boolean foreignKey,
            boolean nullable,
            boolean unique,
            String references,
            String filePath,
            int line
    ) {}

    /** A JPA entity rendered as a database table. */
    public record ErEntityDto(
            String id,
            String className,
            String tableName,
            String filePath,
            int startLine,
            int endLine,
            List<ErColumnDto> columns
    ) {}

    /**
     * A relationship between two tables. {@code type} is one of
     * MANY_TO_ONE, ONE_TO_MANY, ONE_TO_ONE or MANY_TO_MANY (read from source to target).
     */
    public record ErRelationDto(
            String id,
            String source,
            String target,
            String type,
            String fieldName,
            String joinColumn,
            String joinTable
    ) {}

    public record ErDiagramDto(
            Long repositoryId,
            String repoFullName,
            List<ErEntityDto> entities,
            List<ErRelationDto> relations
    ) {}

    public record FileInsightDto(
            String path,
            String role,
            String originalRole,
            double confidence,
            List<String> reasons,
            String summary,
            int clusterId,
            double importance,
            int depth,
            boolean inCycle,
            int fanIn,
            int fanOut
    ) {}

    public record ModuleClusterDto(
            int id,
            String name,
            List<String> files,
            double cohesion,
            String dominantRole
    ) {}

    public record DependencyCycleDto(
            List<String> files
    ) {}

    public record LayerViolationDto(
            String source,
            String target,
            String sourceRole,
            String targetRole,
            String reason
    ) {}

    public record PrunedEdgeDto(
            String source,
            String target,
            String reason
    ) {}

    public record InferredErRelationDto(
            String id,
            String source,
            String target,
            String type,
            String fieldName,
            String joinColumn,
            String joinTable,
            double confidence,
            String evidence,
            String origin
    ) {}

    public record ProjectInsightsDto(
            Long repositoryId,
            String engine,
            String modelUsed,
            boolean aiAvailable,
            Instant generatedAt,
            String architectureStyle,
            String overview,
            List<FileInsightDto> files,
            List<ModuleClusterDto> clusters,
            List<DependencyCycleDto> cycles,
            List<LayerViolationDto> violations,
            List<PrunedEdgeDto> prunedEdges,
            List<InferredErRelationDto> inferredRelations,
            int reclassifiedCount,
            double averageConfidence,
            List<String> warnings
    ) {}
}
