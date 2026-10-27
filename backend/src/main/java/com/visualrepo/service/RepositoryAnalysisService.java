package com.visualrepo.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualrepo.config.ResilientDataSourceConfig;
import com.visualrepo.dto.ApiDtos.*;
import com.visualrepo.model.*;
import com.visualrepo.repository.*;
import com.visualrepo.service.CodeRetrievalService.RetrievalBundle;
import com.visualrepo.service.EmbeddingService.EmbeddingResult;
import com.visualrepo.service.GitHubClientService.FetchedFile;
import com.visualrepo.service.GitHubClientService.FetchedRepository;
import com.visualrepo.service.LanguageRuleAnalyzer.AnalyzedFile;
import com.visualrepo.service.LanguageRuleAnalyzer.ParsedChunk;
import com.visualrepo.service.LanguageRuleAnalyzer.ResolvedEdge;
import com.visualrepo.service.OllamaStructuredAiService.StructuredAiOutput;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class RepositoryAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(RepositoryAnalysisService.class);

    private final RepositoryJpaRepository repositoryJpa;
    private final SourceFileJpaRepository sourceFileJpa;
    private final CodeChunkJpaRepository codeChunkJpa;
    private final DependencyEdgeJpaRepository dependencyEdgeJpa;
    private final AnalysisHistoryJpaRepository analysisHistoryJpa;
    private final GitHubClientService gitHubClientService;
    private final LanguageRuleAnalyzer languageRuleAnalyzer;
    private final EmbeddingService embeddingService;
    private final CodeRetrievalService codeRetrievalService;
    private final OllamaStructuredAiService ollamaAiService;
    private final ResilientDataSourceConfig dataSourceConfig;
    private final ObjectMapper objectMapper;

    @Value("${visualrepo.ollama.chat-model:qwen2.5-coder:7b}")
    private String configuredChatModel;

    @Value("${visualrepo.ollama.embed-model:nomic-embed-text}")
    private String configuredEmbedModel;

    public RepositoryAnalysisService(
            RepositoryJpaRepository repositoryJpa,
            SourceFileJpaRepository sourceFileJpa,
            CodeChunkJpaRepository codeChunkJpa,
            DependencyEdgeJpaRepository dependencyEdgeJpa,
            AnalysisHistoryJpaRepository analysisHistoryJpa,
            GitHubClientService gitHubClientService,
            LanguageRuleAnalyzer languageRuleAnalyzer,
            EmbeddingService embeddingService,
            CodeRetrievalService codeRetrievalService,
            OllamaStructuredAiService ollamaAiService,
            ResilientDataSourceConfig dataSourceConfig,
            ObjectMapper objectMapper
    ) {
        this.repositoryJpa = repositoryJpa;
        this.sourceFileJpa = sourceFileJpa;
        this.codeChunkJpa = codeChunkJpa;
        this.dependencyEdgeJpa = dependencyEdgeJpa;
        this.analysisHistoryJpa = analysisHistoryJpa;
        this.gitHubClientService = gitHubClientService;
        this.languageRuleAnalyzer = languageRuleAnalyzer;
        this.embeddingService = embeddingService;
        this.codeRetrievalService = codeRetrievalService;
        this.ollamaAiService = ollamaAiService;
        this.dataSourceConfig = dataSourceConfig;
        this.objectMapper = objectMapper;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seedDemoRepositoryIfEmpty() {
        try {
            Optional<RepositoryEntity> existingDemo = repositoryJpa
                    .findByOwnerIgnoreCaseAndNameIgnoreCase("demo", "order-payment-platform");
            if (repositoryJpa.count() == 0 || (existingDemo.isPresent() && existingDemo.get().getFileCount() < 10)) {
                log.info("Auto-indexing built-in showcase repository 'demo/order-payment-platform'...");
                indexRepository(new IndexRepoRequest("demo/order-payment-platform", "main", false));
            }
        } catch (Exception e) {
            log.warn("Failed to seed initial demo repository: {}", e.getMessage());
        }
    }

    public SystemStatusDto getSystemStatus() {
        List<String> models = ollamaAiService.listAvailableModels();
        return new SystemStatusDto(
                dataSourceConfig.getActiveDatabaseMode(),
                !models.isEmpty(),
                configuredChatModel,
                configuredEmbedModel,
                models,
                gitHubClientService.isTokenConfigured()
        );
    }

    @Transactional(readOnly = true)
    public List<RepositorySummaryDto> listRepositories() {
        return repositoryJpa.findAllByOrderByLastIndexedAtDescCreatedAtDesc()
                .stream()
                .map(this::toSummaryDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public RepositorySummaryDto getRepository(Long id) {
        RepositoryEntity entity = findRepoOrThrow(id);
        return toSummaryDto(entity);
    }

    @Transactional
    public void deleteRepository(Long id) {
        RepositoryEntity entity = findRepoOrThrow(id);
        analysisHistoryJpa.deleteByRepositoryId(id);
        dependencyEdgeJpa.deleteByRepositoryId(id);
        codeChunkJpa.deleteByRepositoryId(id);
        sourceFileJpa.deleteByRepositoryId(id);
        repositoryJpa.delete(entity);
    }

    @Transactional
    public RepositorySummaryDto indexRepository(IndexRepoRequest request) {
        FetchedRepository fetched = gitHubClientService.fetchRepository(
                request.repoUrlOrFullName(),
                request.branch()
        );

        RepositoryEntity repo = repositoryJpa
                .findByOwnerIgnoreCaseAndNameIgnoreCase(fetched.owner(), fetched.name())
                .orElseGet(RepositoryEntity::new);

        if (repo.getId() != null) {
            dependencyEdgeJpa.deleteByRepositoryId(repo.getId());
            codeChunkJpa.deleteByRepositoryId(repo.getId());
            sourceFileJpa.deleteByRepositoryId(repo.getId());
        }

        repo.setOwner(fetched.owner());
        repo.setName(fetched.name());
        repo.setDefaultBranch(fetched.defaultBranch());
        repo.setCommitSha(fetched.commitSha());
        repo.setHtmlUrl(fetched.htmlUrl());
        repo.setDescription(fetched.description());
        repo.setStatus(IndexingStatus.INDEXING);
        repo.setEmbeddingsGenerated(false);
        repo.setEmbeddingModel(null);
        repo.setErrorMessage(null);
        repo = repositoryJpa.save(repo);

        List<AnalyzedFile> analyzedFiles = new ArrayList<>();
        Map<String, String> fileContentsByPath = new HashMap<>();
        int totalChunks = 0;

        for (FetchedFile ff : fetched.files()) {
            AnalyzedFile analyzed = languageRuleAnalyzer.analyzeFile(ff.path(), ff.content());
            analyzedFiles.add(analyzed);
            fileContentsByPath.put(ff.path(), ff.content());

            SourceFileEntity sf = new SourceFileEntity();
            sf.setRepository(repo);
            sf.setPath(ff.path());
            sf.setLanguage(analyzed.language());
            sf.setArchitecturalRole(analyzed.architecturalRole());
            sf.setLineCount(analyzed.lineCount());
            sf.setSizeBytes(ff.sizeBytes());
            sf.setSha(ff.sha());
            sf.setContent(ff.content());
            sf.setImportsJson(writeJsonSafe(analyzed.imports()));
            sf.setSymbolsJson(writeJsonSafe(analyzed.symbols()));
            sf = sourceFileJpa.save(sf);

            for (ParsedChunk pc : analyzed.chunks()) {
                CodeChunkEntity chunk = new CodeChunkEntity();
                chunk.setRepository(repo);
                chunk.setSourceFile(sf);
                chunk.setFilePath(ff.path());
                chunk.setStartLine(pc.startLine());
                chunk.setEndLine(pc.endLine());
                chunk.setSymbolName(pc.symbolName());
                chunk.setChunkType(pc.chunkType());
                chunk.setContent(pc.content());
                codeChunkJpa.save(chunk);
                totalChunks++;
            }
        }

        List<ResolvedEdge> resolvedEdges = languageRuleAnalyzer.resolveDependencyEdges(analyzedFiles, fileContentsByPath);
        for (ResolvedEdge re : resolvedEdges) {
            DependencyEdgeEntity edge = new DependencyEdgeEntity();
            edge.setRepository(repo);
            edge.setSourceFilePath(re.sourceFilePath());
            edge.setTargetFilePath(re.targetFilePath());
            edge.setRelationType(re.relationType());
            edge.setTargetSymbol(re.targetSymbol());
            dependencyEdgeJpa.save(edge);
        }

        repo.setFileCount(analyzedFiles.size());
        repo.setChunkCount(totalChunks);
        repo.setEdgeCount(resolvedEdges.size());
        repo.setStatus(IndexingStatus.INDEXED);
        repo.setLastIndexedAt(Instant.now());
        repo = repositoryJpa.save(repo);

        if (Boolean.TRUE.equals(request.generateEmbeddingsImmediately())) {
            return generateEmbeddings(repo.getId());
        }

        return toSummaryDto(repo);
    }

    @Transactional
    public RepositorySummaryDto generateEmbeddings(Long repositoryId) {
        RepositoryEntity repo = findRepoOrThrow(repositoryId);
        repo.setStatus(IndexingStatus.EMBEDDING);
        repositoryJpa.save(repo);

        List<CodeChunkEntity> chunks = codeChunkJpa.findByRepositoryIdOrderByFilePathAscStartLineAsc(repositoryId);
        String modelUsed = configuredEmbedModel;

        for (CodeChunkEntity chunk : chunks) {
            String compositeInput = "File: " + chunk.getFilePath()
                    + " | Symbol: " + chunk.getSymbolName()
                    + " (L" + chunk.getStartLine() + "-L" + chunk.getEndLine() + ")\n"
                    + chunk.getContent();
            EmbeddingResult result = embeddingService.embedText(compositeInput);
            chunk.setEmbeddingJson(embeddingService.serializeVector(result.vector()));
            modelUsed = result.modelUsed();
        }
        codeChunkJpa.saveAll(chunks);

        repo.setEmbeddingsGenerated(true);
        repo.setEmbeddingModel(modelUsed);
        repo.setStatus(IndexingStatus.READY);
        repo = repositoryJpa.save(repo);

        return toSummaryDto(repo);
    }

    @Transactional(readOnly = true)
    public List<SourceFileSummaryDto> listRepositoryFiles(Long repositoryId) {
        findRepoOrThrow(repositoryId);
        return sourceFileJpa.findByRepositoryIdOrderByPathAsc(repositoryId)
                .stream()
                .map(sf -> {
                    List<String> imports = readJsonSafe(sf.getImportsJson(), new TypeReference<List<String>>() {}, List.of());
                    List<SymbolInfoDto> symbols = readJsonSafe(sf.getSymbolsJson(), new TypeReference<List<SymbolInfoDto>>() {}, List.of());
                    return new SourceFileSummaryDto(
                            sf.getId(),
                            sf.getPath(),
                            sf.getLanguage(),
                            sf.getArchitecturalRole(),
                            sf.getLineCount(),
                            sf.getSizeBytes(),
                            symbols.size(),
                            imports.size()
                    );
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public SourceFileDetailDto getSourceFileDetail(Long repositoryId, String filePath) {
        RepositoryEntity repo = findRepoOrThrow(repositoryId);
        SourceFileEntity sf = sourceFileJpa.findByRepositoryIdAndPath(repositoryId, filePath)
                .orElseThrow(() -> new IllegalArgumentException("File not found in indexed repository: " + filePath));

        List<String> imports = readJsonSafe(sf.getImportsJson(), new TypeReference<List<String>>() {}, List.of());
        List<SymbolInfoDto> symbols = readJsonSafe(sf.getSymbolsJson(), new TypeReference<List<SymbolInfoDto>>() {}, List.of());

        List<String> outgoing = dependencyEdgeJpa.findByRepositoryIdAndSourceFilePath(repositoryId, filePath)
                .stream()
                .map(DependencyEdgeEntity::getTargetFilePath)
                .distinct()
                .toList();

        List<String> incoming = dependencyEdgeJpa.findByRepositoryIdAndTargetFilePath(repositoryId, filePath)
                .stream()
                .map(DependencyEdgeEntity::getSourceFilePath)
                .distinct()
                .toList();

        String blobUrl = repo.getHtmlUrl() + "/blob/" + repo.getDefaultBranch() + "/" + sf.getPath();

        return new SourceFileDetailDto(
                sf.getId(),
                sf.getPath(),
                sf.getLanguage(),
                sf.getArchitecturalRole(),
                sf.getLineCount(),
                sf.getSizeBytes(),
                sf.getContent(),
                imports,
                symbols,
                outgoing,
                incoming,
                blobUrl
        );
    }

    @Transactional(readOnly = true)
    public ArchitectureGraphDto getArchitectureGraph(Long repositoryId) {
        RepositoryEntity repo = findRepoOrThrow(repositoryId);
        List<SourceFileEntity> files = sourceFileJpa.findByRepositoryIdOrderByPathAsc(repositoryId);
        List<DependencyEdgeEntity> edges = dependencyEdgeJpa.findByRepositoryId(repositoryId);

        Map<String, Integer> incomingCounts = new HashMap<>();
        Map<String, Integer> outgoingCounts = new HashMap<>();
        for (DependencyEdgeEntity edge : edges) {
            outgoingCounts.merge(edge.getSourceFilePath(), 1, Integer::sum);
            incomingCounts.merge(edge.getTargetFilePath(), 1, Integer::sum);
        }

        Map<String, Integer> roleCounts = new LinkedHashMap<>();
        Map<String, Integer> languageCounts = new LinkedHashMap<>();
        Map<Integer, List<SourceFileEntity>> filesByTier = new TreeMap<>();

        for (SourceFileEntity sf : files) {
            roleCounts.merge(sf.getArchitecturalRole(), 1, Integer::sum);
            languageCounts.merge(sf.getLanguage(), 1, Integer::sum);
            int tier = roleToTierIndex(sf.getArchitecturalRole());
            filesByTier.computeIfAbsent(tier, k -> new ArrayList<>()).add(sf);
        }

        List<GraphNodeDto> nodeDtos = new ArrayList<>();
        for (Map.Entry<Integer, List<SourceFileEntity>> tierEntry : filesByTier.entrySet()) {
            int tier = tierEntry.getKey();
            List<SourceFileEntity> tierFiles = tierEntry.getValue();
            double x = 60.0 + tier * 310.0;
            for (int row = 0; row < tierFiles.size(); row++) {
                SourceFileEntity sf = tierFiles.get(row);
                double y = 70.0 + row * 155.0;
                List<SymbolInfoDto> symbols = readJsonSafe(
                        sf.getSymbolsJson(),
                        new TypeReference<List<SymbolInfoDto>>() {},
                        List.of()
                );
                List<String> symbolNames = symbols.stream()
                        .map(SymbolInfoDto::name)
                        .limit(5)
                        .toList();

                String label = sf.getPath().contains("/")
                        ? sf.getPath().substring(sf.getPath().lastIndexOf('/') + 1)
                        : sf.getPath();
                String directory = sf.getPath().contains("/")
                        ? sf.getPath().substring(0, sf.getPath().lastIndexOf('/'))
                        : "/";

                nodeDtos.add(new GraphNodeDto(
                        sf.getPath(),
                        sf.getPath(),
                        label,
                        directory,
                        sf.getLanguage(),
                        sf.getArchitecturalRole(),
                        tierName(tier),
                        sf.getLineCount(),
                        symbolNames,
                        incomingCounts.getOrDefault(sf.getPath(), 0),
                        outgoingCounts.getOrDefault(sf.getPath(), 0),
                        x,
                        y
                ));
            }
        }

        List<GraphEdgeDto> edgeDtos = new ArrayList<>();
        int idx = 1;
        for (DependencyEdgeEntity e : edges) {
            edgeDtos.add(new GraphEdgeDto(
                    "edge-" + (idx++),
                    e.getSourceFilePath(),
                    e.getTargetFilePath(),
                    e.getRelationType(),
                    e.getTargetSymbol()
            ));
        }

        return new ArchitectureGraphDto(
                repo.getId(),
                repo.getOwner() + "/" + repo.getName(),
                nodeDtos,
                edgeDtos,
                roleCounts,
                languageCounts
        );
    }

    @Transactional
    public CitedAnswerResponseDto askQuestion(Long repositoryId, AskQuestionRequest request) {
        RepositoryEntity repo = findRepoOrThrow(repositoryId);
        List<SourceFileEntity> files = sourceFileJpa.findByRepositoryIdOrderByPathAsc(repositoryId);
        Map<String, SourceFileEntity> filesByPath = files.stream()
                .collect(Collectors.toMap(SourceFileEntity::getPath, f -> f, (a, b) -> a));

        RetrievalBundle retrieval = codeRetrievalService.retrieveRelevantChunks(
                repo,
                request.question(),
                request.retrievalMode()
        );

        StructuredAiOutput aiOutput = ollamaAiService.generateCitedAnswer(
                repo,
                request.question(),
                retrieval.topChunks(),
                filesByPath,
                request.modelOverride()
        );

        AnalysisHistoryEntity history = new AnalysisHistoryEntity();
        history.setRepository(repo);
        history.setQuestion(request.question());
        history.setAnswer(aiOutput.answer());
        history.setArchitecturalSummary(aiOutput.architecturalSummary());
        history.setCitationsJson(writeJsonSafe(aiOutput.verifiedCitations()));
        history.setRetrievalMode(retrieval.modeUsed());
        history.setModelUsed(aiOutput.modelUsed());
        history = analysisHistoryJpa.save(history);

        return new CitedAnswerResponseDto(
                history.getId(),
                history.getQuestion(),
                history.getAnswer(),
                history.getArchitecturalSummary(),
                aiOutput.verifiedCitations(),
                history.getModelUsed(),
                history.getRetrievalMode(),
                history.getCreatedAt()
        );
    }

    @Transactional(readOnly = true)
    public List<CitedAnswerResponseDto> listAnalysisHistory(Long repositoryId) {
        findRepoOrThrow(repositoryId);
        return analysisHistoryJpa.findByRepositoryIdOrderByCreatedAtDesc(repositoryId)
                .stream()
                .map(h -> new CitedAnswerResponseDto(
                        h.getId(),
                        h.getQuestion(),
                        h.getAnswer(),
                        h.getArchitecturalSummary(),
                        readJsonSafe(h.getCitationsJson(), new TypeReference<List<CitationDto>>() {}, List.of()),
                        h.getModelUsed(),
                        h.getRetrievalMode(),
                        h.getCreatedAt()
                ))
                .toList();
    }

    private RepositoryEntity findRepoOrThrow(Long id) {
        return repositoryJpa.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Repository not found with ID: " + id));
    }

    private RepositorySummaryDto toSummaryDto(RepositoryEntity r) {
        return new RepositorySummaryDto(
                r.getId(),
                r.getOwner(),
                r.getName(),
                r.getDefaultBranch(),
                r.getCommitSha(),
                r.getHtmlUrl(),
                r.getDescription(),
                r.getStatus(),
                r.isEmbeddingsGenerated(),
                r.getEmbeddingModel(),
                r.getFileCount(),
                r.getChunkCount(),
                r.getEdgeCount(),
                r.getErrorMessage(),
                r.getCreatedAt(),
                r.getLastIndexedAt()
        );
    }

    private int roleToTierIndex(String role) {
        return switch (role) {
            case "UI_COMPONENT", "API_CLIENT" -> 0;
            case "CONTROLLER" -> 1;
            case "SERVICE" -> 2;
            case "REPOSITORY", "CONFIG" -> 3;
            case "MODEL" -> 4;
            default -> 5;
        };
    }

    private String tierName(int tier) {
        return switch (tier) {
            case 0 -> "Frontend / Client Layer";
            case 1 -> "API / Controller Layer";
            case 2 -> "Business Service Layer";
            case 3 -> "Data Access & Config Layer";
            case 4 -> "Domain Model & Entities";
            default -> "Modules & Utilities";
        };
    }

    private String writeJsonSafe(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return "[]";
        }
    }

    private <T> T readJsonSafe(String json, TypeReference<T> typeRef, T defaultVal) {
        if (json == null || json.isBlank()) {
            return defaultVal;
        }
        try {
            return objectMapper.readValue(json, typeRef);
        } catch (Exception e) {
            return defaultVal;
        }
    }
}
