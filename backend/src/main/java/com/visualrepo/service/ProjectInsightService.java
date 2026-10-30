package com.visualrepo.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualrepo.dto.ApiDtos.*;
import com.visualrepo.model.DependencyEdgeEntity;
import com.visualrepo.model.RepositoryEntity;
import com.visualrepo.model.SourceFileEntity;
import com.visualrepo.repository.DependencyEdgeJpaRepository;
import com.visualrepo.repository.RepositoryJpaRepository;
import com.visualrepo.repository.SourceFileJpaRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Deep architectural and database ER analysis engine supporting both a deterministic
 * graph/schema algorithm ("algorithm") and a hybrid local Ollama AI mode ("ollama").
 */
@Service
public class ProjectInsightService {

    private static final Logger log = LoggerFactory.getLogger(ProjectInsightService.class);

    public static final Set<String> VALID_ROLES = Set.of(
            "UI_COMPONENT",
            "API_CLIENT",
            "CONTROLLER",
            "SERVICE",
            "REPOSITORY",
            "MODEL",
            "MODULE",
            "CONFIG",
            "TEST"
    );

    private static final Map<String, Integer> LAYER_RANK = Map.of(
            "UI_COMPONENT", 0,
            "API_CLIENT", 1,
            "CONTROLLER", 2,
            "SERVICE", 3,
            "REPOSITORY", 4,
            "MODEL", 5
    );

    private static final Set<String> VALID_ER_TYPES = Set.of(
            "MANY_TO_ONE",
            "ONE_TO_MANY",
            "ONE_TO_ONE",
            "MANY_TO_MANY"
    );

    private static final Set<String> STOP_WORDS = Set.of(
            "src", "main", "test", "tests", "java", "kotlin", "python", "resources",
            "com", "org", "net", "io", "app", "lib", "core", "common", "shared",
            "utils", "util", "helpers", "helper", "internal", "pkg", "cmd",
            "frontend", "backend", "client", "server", "web", "ui", "api",
            "controller", "controllers", "service", "services", "repository", "repositories",
            "model", "models", "entity", "entities", "dto", "dtos", "config", "configs",
            "components", "pages", "views", "routes", "routers", "types", "schema", "schemas",
            "db", "database", "store", "stores", "dao"
    );

    private final RepositoryJpaRepository repositoryJpa;
    private final SourceFileJpaRepository sourceFileJpa;
    private final DependencyEdgeJpaRepository dependencyEdgeJpa;
    private final ErDiagramService erDiagramService;
    private final OllamaStructuredAiService ollamaAiService;
    private final ObjectMapper objectMapper;
    private final RestClient ollamaRestClient;

    @Value("${visualrepo.ollama.base-url:http://localhost:11434}")
    private String ollamaBaseUrl;

    @Value("${visualrepo.ollama.chat-model:qwen2.5-coder:7b}")
    private String defaultChatModel;

    private final Map<String, ProjectInsightsDto> insightCache = new ConcurrentHashMap<>();

    public ProjectInsightService(
            RepositoryJpaRepository repositoryJpa,
            SourceFileJpaRepository sourceFileJpa,
            DependencyEdgeJpaRepository dependencyEdgeJpa,
            ErDiagramService erDiagramService,
            OllamaStructuredAiService ollamaAiService,
            ObjectMapper objectMapper
    ) {
        this.repositoryJpa = repositoryJpa;
        this.sourceFileJpa = sourceFileJpa;
        this.dependencyEdgeJpa = dependencyEdgeJpa;
        this.erDiagramService = erDiagramService;
        this.ollamaAiService = ollamaAiService;
        this.objectMapper = objectMapper;

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofSeconds(8).toMillis());
        factory.setReadTimeout((int) Duration.ofSeconds(90).toMillis());
        this.ollamaRestClient = RestClient.builder().requestFactory(factory).build();
    }

    @Transactional(readOnly = true)
    public ProjectInsightsDto getProjectInsights(
            Long repositoryId,
            String requestedEngine,
            String modelOverride,
            boolean refresh
    ) {
        RepositoryEntity repo = repositoryJpa.findById(repositoryId)
                .orElseThrow(() -> new IllegalArgumentException("Repository not found with ID: " + repositoryId));

        String normalizedEngine = "ollama".equalsIgnoreCase(requestedEngine) ? "ollama" : "algorithm";
        String normalizedModel = (modelOverride != null && !modelOverride.isBlank())
                ? modelOverride.trim()
                : defaultChatModel;
        String indexStamp = repo.getLastIndexedAt() != null
                ? repo.getLastIndexedAt().toString()
                : String.valueOf(repo.getFileCount());
        String cacheKey = repositoryId + ":" + normalizedEngine + ":" + normalizedModel + ":" + indexStamp;

        if (!refresh && insightCache.containsKey(cacheKey)) {
            return insightCache.get(cacheKey);
        }

        List<SourceFileEntity> files = sourceFileJpa.findByRepositoryIdOrderByPathAsc(repositoryId);
        List<DependencyEdgeEntity> rawEdges = dependencyEdgeJpa.findByRepositoryId(repositoryId);
        ErDiagramDto erDiagram = erDiagramService.getErDiagram(repositoryId);

        ProjectInsightsDto result = computeInsights(
                repo,
                files,
                rawEdges,
                erDiagram,
                normalizedEngine,
                modelOverride
        );

        insightCache.put(cacheKey, result);
        return result;
    }

    /**
     * Package-visible core pipeline so unit tests can invoke it directly without database mocks.
     */
    ProjectInsightsDto computeInsights(
            RepositoryEntity repo,
            List<SourceFileEntity> files,
            List<DependencyEdgeEntity> rawEdges,
            ErDiagramDto erDiagram,
            String requestedEngine,
            String modelOverride
    ) {
        List<String> warnings = new ArrayList<>();
        Map<String, SourceFileEntity> fileByPath = new LinkedHashMap<>();
        Map<String, String> strippedContentByPath = new HashMap<>();
        Map<String, List<SymbolInfoDto>> symbolsByPath = new HashMap<>();

        for (SourceFileEntity sf : files) {
            fileByPath.put(sf.getPath(), sf);
            strippedContentByPath.put(
                    sf.getPath(),
                    LanguageRuleAnalyzer.stripCommentsAndStrings(sf.getContent())
            );
            symbolsByPath.put(sf.getPath(), parseSymbols(sf.getSymbolsJson()));
        }

        // 1. Edge Verification & Pruning
        List<PrunedEdgeDto> prunedEdges = new ArrayList<>();
        List<DependencyEdgeEntity> cleanEdges = new ArrayList<>();
        Set<String> seenCleanEdgeKeys = new HashSet<>();

        for (DependencyEdgeEntity edge : rawEdges) {
            String src = edge.getSourceFilePath();
            String tgt = edge.getTargetFilePath();
            if (src == null || tgt == null || src.equals(tgt)) {
                continue;
            }
            if (!fileByPath.containsKey(src) || !fileByPath.containsKey(tgt)) {
                continue;
            }

            if ("INJECTION".equalsIgnoreCase(edge.getRelationType())) {
                String targetSimple = stripExtension(extractSimpleFilename(tgt));
                String sym = (edge.getTargetSymbol() != null && !edge.getTargetSymbol().isBlank())
                        ? edge.getTargetSymbol()
                        : targetSimple;
                String strippedSrc = strippedContentByPath.getOrDefault(src, "");
                if (!LanguageRuleAnalyzer.containsIdentifierToken(strippedSrc, sym)
                        && !LanguageRuleAnalyzer.containsIdentifierToken(strippedSrc, targetSimple)) {
                    prunedEdges.add(new PrunedEdgeDto(
                            src,
                            tgt,
                            "Pruned false-positive substring match for '" + sym + "' in " + extractSimpleFilename(src)
                    ));
                    continue;
                }
            }

            String key = src + "->" + tgt;
            if (seenCleanEdgeKeys.add(key)) {
                cleanEdges.add(edge);
            }
        }

        // Build adjacency lists on cleaned graph
        Map<String, Set<String>> outgoing = new HashMap<>();
        Map<String, Set<String>> incoming = new HashMap<>();
        Map<String, Set<String>> apiCallSources = new HashMap<>();
        Map<String, Set<String>> apiCallTargets = new HashMap<>();

        for (SourceFileEntity sf : files) {
            outgoing.put(sf.getPath(), new LinkedHashSet<>());
            incoming.put(sf.getPath(), new LinkedHashSet<>());
        }
        for (DependencyEdgeEntity e : cleanEdges) {
            outgoing.get(e.getSourceFilePath()).add(e.getTargetFilePath());
            incoming.get(e.getTargetFilePath()).add(e.getSourceFilePath());
            if ("API_CALL".equalsIgnoreCase(e.getRelationType())) {
                apiCallTargets.computeIfAbsent(e.getSourceFilePath(), k -> new LinkedHashSet<>()).add(e.getTargetFilePath());
                apiCallSources.computeIfAbsent(e.getTargetFilePath(), k -> new LinkedHashSet<>()).add(e.getSourceFilePath());
            }
        }

        // 2. Multi-signal role classification (Pass 1: intrinsic file & AST signals)
        Map<String, Map<String, Double>> roleScoresByPath = new LinkedHashMap<>();
        Map<String, Map<String, List<String>>> roleReasonsByPath = new LinkedHashMap<>();
        Map<String, String> provisionalRoleByPath = new HashMap<>();

        for (SourceFileEntity sf : files) {
            Map<String, Double> scores = new LinkedHashMap<>();
            Map<String, List<String>> reasons = new LinkedHashMap<>();
            for (String r : VALID_ROLES) {
                scores.put(r, 0.0);
                reasons.put(r, new ArrayList<>());
            }

            scoreIntrinsicSignals(
                    sf,
                    strippedContentByPath.getOrDefault(sf.getPath(), ""),
                    symbolsByPath.getOrDefault(sf.getPath(), List.of()),
                    scores,
                    reasons
            );

            roleScoresByPath.put(sf.getPath(), scores);
            roleReasonsByPath.put(sf.getPath(), reasons);
            provisionalRoleByPath.put(sf.getPath(), pickTopRole(scores, sf.getArchitecturalRole()));
        }

        // Pass 2: Graph neighborhood propagation
        for (SourceFileEntity sf : files) {
            String path = sf.getPath();
            Map<String, Double> scores = roleScoresByPath.get(path);
            Map<String, List<String>> reasons = roleReasonsByPath.get(path);
            Set<String> inPeers = incoming.getOrDefault(path, Set.of());
            Set<String> outPeers = outgoing.getOrDefault(path, Set.of());

            if (apiCallTargets.containsKey(path)) {
                addSignal(scores, reasons, "API_CLIENT", 3.2,
                        "Makes cross-stack HTTP calls to backend API endpoints");
            }
            if (apiCallSources.containsKey(path)) {
                addSignal(scores, reasons, "CONTROLLER", 3.5,
                        "Receives cross-stack HTTP requests from frontend callers");
            }

            long callersAreControllers = inPeers.stream()
                    .filter(p -> "CONTROLLER".equals(provisionalRoleByPath.get(p)))
                    .count();
            long calleesAreReposOrModels = outPeers.stream()
                    .filter(p -> {
                        String r = provisionalRoleByPath.get(p);
                        return "REPOSITORY".equals(r) || "MODEL".equals(r);
                    })
                    .count();

            if (callersAreControllers > 0 && calleesAreReposOrModels > 0) {
                addSignal(scores, reasons, "SERVICE", 3.0,
                        "Orchestrates between Controller callers and Repository/Model dependencies");
            } else if (callersAreControllers > 0 && !"MODEL".equals(provisionalRoleByPath.get(path))) {
                addSignal(scores, reasons, "SERVICE", 1.6,
                        "Directly invoked by API Controller layer");
            }

            long callersAreServices = inPeers.stream()
                    .filter(p -> "SERVICE".equals(provisionalRoleByPath.get(p)))
                    .count();
            long calleesAreModels = outPeers.stream()
                    .filter(p -> "MODEL".equals(provisionalRoleByPath.get(p)))
                    .count();

            if (callersAreServices > 0 && calleesAreModels > 0 && outPeers.size() == calleesAreModels) {
                addSignal(scores, reasons, "REPOSITORY", 1.8,
                        "Called by Services and depends exclusively on Domain Models");
            }

            if (outPeers.isEmpty() && inPeers.size() >= 2) {
                long domainCallers = inPeers.stream()
                        .filter(p -> {
                            String r = provisionalRoleByPath.get(p);
                            return "SERVICE".equals(r) || "REPOSITORY".equals(r) || "CONTROLLER".equals(r);
                        })
                        .count();
                if (domainCallers >= 2 && scores.getOrDefault("MODEL", 0.0) >= 1.5) {
                    addSignal(scores, reasons, "MODEL", 2.0,
                            "Zero outgoing dependencies and shared across " + inPeers.size() + " domain files");
                }
            }
        }

        // 3. Graph Metrics: PageRank, Tarjan SCC Cycles, Topological Depth, Community Clusters
        Map<String, Double> pageRank = computePageRank(files, outgoing, incoming);
        List<DependencyCycleDto> cycles = computeStronglyConnectedCycles(files, outgoing);
        Set<String> filesInCycle = new HashSet<>();
        for (DependencyCycleDto c : cycles) {
            filesInCycle.addAll(c.files());
        }

        Map<String, String> finalRoleByPath = new LinkedHashMap<>();
        Map<String, Double> confidenceByPath = new LinkedHashMap<>();
        Map<String, List<String>> topReasonsByPath = new LinkedHashMap<>();
        Map<String, String> summaryByPath = new LinkedHashMap<>();

        for (SourceFileEntity sf : files) {
            String path = sf.getPath();
            Map<String, Double> scores = roleScoresByPath.get(path);
            Map<String, List<String>> reasons = roleReasonsByPath.get(path);
            String bestRole = pickTopRole(scores, sf.getArchitecturalRole());
            double confidence = computeConfidence(scores, bestRole);
            List<String> bestReasons = new ArrayList<>(reasons.getOrDefault(bestRole, List.of()));
            if (bestReasons.isEmpty()) {
                bestReasons.add("Classified as " + bestRole + " from path and module structure");
            }
            if (bestReasons.size() > 4) {
                bestReasons = bestReasons.subList(0, 4);
            }

            finalRoleByPath.put(path, bestRole);
            confidenceByPath.put(path, confidence);
            topReasonsByPath.put(path, bestReasons);
            summaryByPath.put(
                    path,
                    buildDeterministicFileSummary(
                            sf,
                            bestRole,
                            symbolsByPath.getOrDefault(path, List.of()),
                            incoming.getOrDefault(path, Set.of()).size(),
                            outgoing.getOrDefault(path, Set.of()).size()
                    )
            );
        }

        Map<String, Integer> depthByPath = computeTopologicalDepth(files, outgoing, incoming, finalRoleByPath);

        // 4. Community / Module Cluster Detection
        ClusterAssignment clusterResult = computeModuleClusters(files, outgoing, incoming, finalRoleByPath);

        // 5. Algorithmic Database ER Relationship Inference
        List<InferredErRelationDto> inferredRelations = inferErRelationsAlgorithmically(erDiagram);

        // 6. Optional Local Ollama AI Refinement
        List<String> availableModels = ollamaAiService.listAvailableModels();
        boolean aiAvailable = !availableModels.isEmpty();
        String effectiveEngine = "algorithm";
        String modelUsed = "graph-algorithms";
        String aiArchStyle = null;
        String aiOverview = null;

        if ("ollama".equalsIgnoreCase(requestedEngine)) {
            if (!aiAvailable) {
                warnings.add("Local Ollama server is offline; used deterministic graph & schema algorithms.");
            } else {
                String chosenModel = resolveOllamaModel(modelOverride, availableModels, warnings);
                boolean anyAiSuccess = false;

                // 6a. Refine file roles & summaries via Ollama structured output
                try {
                    boolean refined = refineFilesWithOllama(
                            repo,
                            files,
                            chosenModel,
                            pageRank,
                            confidenceByPath,
                            finalRoleByPath,
                            topReasonsByPath,
                            summaryByPath,
                            symbolsByPath,
                            outgoing
                    );
                    if (refined) {
                        anyAiSuccess = true;
                    }
                } catch (Exception e) {
                    log.warn("Ollama file insight refinement failed: {}", e.getMessage());
                    warnings.add("Ollama file classification timed out or failed; kept algorithmic roles.");
                }

                // 6b. Infer semantic ER relations via Ollama structured output
                if (erDiagram != null && erDiagram.entities().size() >= 2) {
                    try {
                        List<InferredErRelationDto> aiEr = inferErRelationsWithOllama(
                                repo,
                                erDiagram,
                                inferredRelations,
                                chosenModel
                        );
                        if (!aiEr.isEmpty()) {
                            inferredRelations.addAll(aiEr);
                            anyAiSuccess = true;
                        }
                    } catch (Exception e) {
                        log.warn("Ollama ER inference failed: {}", e.getMessage());
                        warnings.add("Ollama ER relationship inference skipped: " + e.getMessage());
                    }
                }

                // 6c. Synthesize architecture style & overview via Ollama
                try {
                    ArchNarrative narrative = generateArchitectureNarrativeWithOllama(
                            repo,
                            files.size(),
                            cleanEdges.size(),
                            finalRoleByPath,
                            clusterResult.clusters(),
                            chosenModel
                    );
                    if (narrative != null) {
                        aiArchStyle = narrative.architectureStyle();
                        aiOverview = narrative.overview();
                        anyAiSuccess = true;
                    }
                } catch (Exception e) {
                    log.warn("Ollama architecture narrative generation failed: {}", e.getMessage());
                }

                if (anyAiSuccess) {
                    effectiveEngine = "ollama";
                    modelUsed = chosenModel;
                } else {
                    warnings.add("Ollama returned no valid structured insights; fell back to graph algorithms.");
                }
            }
        }

        // 7. Recompute Layer Violations with final roles
        List<LayerViolationDto> violations = detectLayerViolations(cleanEdges, finalRoleByPath);

        // 8. Assemble FileInsightDto list
        List<FileInsightDto> fileInsights = new ArrayList<>(files.size());
        int reclassifiedCount = 0;
        double confidenceSum = 0.0;

        for (SourceFileEntity sf : files) {
            String path = sf.getPath();
            String origRole = sf.getArchitecturalRole() != null ? sf.getArchitecturalRole() : "MODULE";
            String finalRole = finalRoleByPath.getOrDefault(path, origRole);
            if (!finalRole.equals(origRole)) {
                reclassifiedCount++;
            }
            double conf = round2(confidenceByPath.getOrDefault(path, 0.75));
            confidenceSum += conf;

            fileInsights.add(new FileInsightDto(
                    path,
                    finalRole,
                    origRole,
                    conf,
                    topReasonsByPath.getOrDefault(path, List.of()),
                    summaryByPath.getOrDefault(path, ""),
                    clusterResult.clusterByPath().getOrDefault(path, 0),
                    round2(pageRank.getOrDefault(path, 0.0)),
                    depthByPath.getOrDefault(path, 0),
                    filesInCycle.contains(path),
                    incoming.getOrDefault(path, Set.of()).size(),
                    outgoing.getOrDefault(path, Set.of()).size()
            ));
        }

        double avgConfidence = files.isEmpty() ? 1.0 : round2(confidenceSum / files.size());

        // 9. Architecture Style & Overview (AI or deterministic synthesis)
        ArchNarrative fallbackNarrative = buildDeterministicNarrative(
                repo,
                files.size(),
                cleanEdges.size(),
                finalRoleByPath,
                clusterResult.clusters(),
                cycles.size(),
                violations.size(),
                erDiagram != null ? erDiagram.entities().size() : 0,
                inferredRelations.size()
        );

        String architectureStyle = (aiArchStyle != null && !aiArchStyle.isBlank())
                ? aiArchStyle
                : fallbackNarrative.architectureStyle();
        String overview = (aiOverview != null && !aiOverview.isBlank())
                ? aiOverview
                : fallbackNarrative.overview();

        return new ProjectInsightsDto(
                repo.getId(),
                effectiveEngine,
                modelUsed,
                aiAvailable,
                Instant.now(),
                architectureStyle,
                overview,
                fileInsights,
                clusterResult.clusters(),
                cycles,
                violations,
                prunedEdges,
                inferredRelations,
                reclassifiedCount,
                avgConfidence,
                warnings
        );
    }

    private void scoreIntrinsicSignals(
            SourceFileEntity sf,
            String strippedContent,
            List<SymbolInfoDto> symbols,
            Map<String, Double> scores,
            Map<String, List<String>> reasons
    ) {
        String path = sf.getPath();
        String lowerPath = "/" + path.toLowerCase(Locale.ROOT);
        String fileName = extractSimpleFilename(lowerPath);
        String baseName = stripExtension(fileName);
        String lang = sf.getLanguage() != null ? sf.getLanguage() : "";
        String rawContent = sf.getContent() != null ? sf.getContent() : "";

        // Small baseline from original indexer role
        if (sf.getArchitecturalRole() != null && VALID_ROLES.contains(sf.getArchitecturalRole())) {
            addSignal(scores, reasons, sf.getArchitecturalRole(), 0.8,
                    "Initial lexical role: " + sf.getArchitecturalRole());
        }

        // 1. TEST signals
        if (lowerPath.contains("/test/") || lowerPath.contains("/tests/") || lowerPath.contains("/__tests__/")
                || fileName.endsWith("test.java") || fileName.endsWith("tests.java")
                || fileName.startsWith("test_") || fileName.endsWith("_test.py") || fileName.endsWith("_test.go")
                || fileName.contains(".spec.") || fileName.contains(".test.")) {
            addSignal(scores, reasons, "TEST", 6.0, "Located in test path or test filename convention");
        }
        if (strippedContent.contains("@Test") || strippedContent.contains("@SpringBootTest")
                || strippedContent.contains("assertEquals(") || strippedContent.contains("assertThat(")
                || strippedContent.contains("describe(") || strippedContent.contains("pytest")) {
            addSignal(scores, reasons, "TEST", 3.5, "Contains unit/integration test annotations or assertions");
        }

        // 2. CONFIG signals
        if (lowerPath.contains("/config/") || lowerPath.contains("/configs/") || lowerPath.contains("/settings/")
                || fileName.endsWith("config.java") || fileName.equals("config.py") || fileName.equals("settings.py")
                || fileName.contains(".config.") || "Configuration".equals(lang) || "Markdown".equals(lang)) {
            addSignal(scores, reasons, "CONFIG", 4.5, "Configuration/settings path or file format");
        }
        if (strippedContent.contains("@Configuration") || strippedContent.contains("@Bean")
                || strippedContent.contains("@EnableWebSecurity") || strippedContent.contains("WebMvcConfigurer")) {
            addSignal(scores, reasons, "CONFIG", 4.2, "Declares Spring @Configuration / @Bean wiring");
        }

        // 3. CONTROLLER signals
        if (lowerPath.contains("/controller/") || lowerPath.contains("/controllers/")
                || lowerPath.contains("/routes/") || lowerPath.contains("/routers/")
                || lowerPath.contains("/endpoints/") || lowerPath.contains("/handlers/")) {
            addSignal(scores, reasons, "CONTROLLER", 3.5, "Located in API controller/routes directory");
        }
        if (baseName.endsWith("controller") || baseName.endsWith("router") || baseName.endsWith("resource")
                || baseName.endsWith("endpoint") || baseName.endsWith("handler")) {
            addSignal(scores, reasons, "CONTROLLER", 3.0, "Filename suffix indicates request controller/router");
        }
        if (strippedContent.contains("@RestController") || strippedContent.contains("@Controller")
                || strippedContent.contains("@GetMapping") || strippedContent.contains("@PostMapping")
                || strippedContent.contains("@PutMapping") || strippedContent.contains("@DeleteMapping")
                || strippedContent.contains("FastAPI(") || strippedContent.contains("APIRouter(")
                || strippedContent.contains("@app.route") || strippedContent.contains("@router.get")
                || strippedContent.contains("@router.post") || strippedContent.contains("router.get(")
                || strippedContent.contains("router.post(")) {
            addSignal(scores, reasons, "CONTROLLER", 5.2, "Exposes HTTP REST endpoints or route mappings");
        }

        // 4. SERVICE signals
        if (lowerPath.contains("/service/") || lowerPath.contains("/services/")
                || lowerPath.contains("/usecase/") || lowerPath.contains("/usecases/")
                || lowerPath.contains("/orchestrator/") || lowerPath.contains("/pipeline/")
                || lowerPath.contains("/rag/")) {
            addSignal(scores, reasons, "SERVICE", 3.4, "Located in business service/use-case directory");
        }
        if (baseName.endsWith("service") || baseName.endsWith("serviceimpl")
                || baseName.endsWith("usecase") || baseName.endsWith("orchestrator")
                || baseName.endsWith("manager") || baseName.endsWith("processor")
                || baseName.endsWith("analyzer") || baseName.endsWith("parser")) {
            addSignal(scores, reasons, "SERVICE", 2.8, "Filename suffix indicates service or domain processor");
        }
        if (strippedContent.contains("@Service") || strippedContent.contains("@Transactional")) {
            addSignal(scores, reasons, "SERVICE", 4.8, "Annotated with @Service / @Transactional business boundary");
        }

        // 5. REPOSITORY / Data Access signals
        if (lowerPath.contains("/repository/") || lowerPath.contains("/repositories/")
                || lowerPath.contains("/dao/") || lowerPath.contains("/store/") || lowerPath.contains("/stores/")
                || lowerPath.contains("/persistence/")) {
            addSignal(scores, reasons, "REPOSITORY", 3.8, "Located in data access / repository directory");
        }
        if (baseName.endsWith("repository") || baseName.endsWith("jparepository")
                || baseName.endsWith("dao") || baseName.endsWith("store") || baseName.endsWith("vectorstore")) {
            addSignal(scores, reasons, "REPOSITORY", 3.5, "Filename suffix indicates data repository/store");
        }
        if (strippedContent.contains("@Repository") || strippedContent.contains("extends JpaRepository")
                || strippedContent.contains("extends CrudRepository") || strippedContent.contains("EntityManager")
                || strippedContent.contains("JdbcTemplate") || strippedContent.contains("get_or_create_collection")
                || strippedContent.contains("session.query(") || strippedContent.contains("prisma.")) {
            addSignal(scores, reasons, "REPOSITORY", 5.2, "Implements database persistence / repository interface");
        }

        // 6. MODEL / Entity / Schema / DTO signals
        if (lowerPath.contains("/model/") || lowerPath.contains("/models/")
                || lowerPath.contains("/entity/") || lowerPath.contains("/entities/")
                || lowerPath.contains("/domain/") || lowerPath.contains("/schema/") || lowerPath.contains("/schemas/")
                || lowerPath.contains("/dto/") || lowerPath.contains("/dtos/") || lowerPath.contains("/types/")) {
            addSignal(scores, reasons, "MODEL", 3.6, "Located in domain model / entity / DTO / types directory");
        }
        if (baseName.endsWith("entity") || baseName.endsWith("model") || baseName.endsWith("dto")
                || baseName.endsWith("dtos") || baseName.endsWith("schema") || baseName.endsWith("request")
                || baseName.endsWith("response") || "SQL".equals(lang) || fileName.endsWith(".prisma")) {
            addSignal(scores, reasons, "MODEL", 3.4, "Filename or DDL schema indicates data model / DTO");
        }
        if (strippedContent.contains("@Entity") || strippedContent.contains("@Table")
                || strippedContent.contains("@Embeddable") || strippedContent.contains("@MappedSuperclass")
                || strippedContent.contains("CREATE TABLE") || strippedContent.contains("(BaseModel)")
                || strippedContent.contains("@dataclass") || strippedContent.contains("public record ")) {
            addSignal(scores, reasons, "MODEL", 5.0, "Declares database @Entity, SQL table, or typed data record");
        }

        // 7. Frontend UI_COMPONENT vs API_CLIENT vs MODULE
        boolean isFrontend = lowerPath.contains("/frontend/") || lowerPath.contains("/client/")
                || lowerPath.contains("/web/") || lowerPath.contains("/ui/")
                || fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
                || fileName.endsWith(".vue") || fileName.endsWith(".svelte");

        boolean hasJsxMarkup = rawContent.contains("</") || rawContent.contains("/>")
                || strippedContent.contains("React.createElement");

        if (lowerPath.contains("/components/") || lowerPath.contains("/pages/")
                || lowerPath.contains("/views/") || lowerPath.contains("/screens/")
                || lowerPath.contains("/layouts/")) {
            addSignal(scores, reasons, "UI_COMPONENT", 3.8, "Located in UI components/pages/views directory");
        }
        if ((fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) && hasJsxMarkup) {
            addSignal(scores, reasons, "UI_COMPONENT", 4.2, "Renders interactive JSX/TSX component markup");
        }
        if (rawContent.contains("fetch(") || rawContent.contains("axios.") || rawContent.contains("XMLHttpRequest")
                || lowerPath.contains("/api/") && isFrontend
                || baseName.endsWith("client") || baseName.endsWith("api")) {
            addSignal(scores, reasons, "API_CLIENT", 4.5, "Performs frontend HTTP API requests or client bridging");
        }
        if (isFrontend && !hasJsxMarkup && !lowerPath.contains("/types/")) {
            boolean hasHooks = symbols.stream().anyMatch(s -> s.name().startsWith("use"));
            if (hasHooks || lowerPath.contains("/hooks/") || lowerPath.contains("/lib/") || lowerPath.contains("/utils/")) {
                addSignal(scores, reasons, "API_CLIENT", 2.8,
                        "Frontend non-JSX hook/utility module supporting UI state & layout");
            }
        }

        // 8. Shared MODULE fallback signals
        if (lowerPath.contains("/util/") || lowerPath.contains("/utils/")
                || lowerPath.contains("/helper/") || lowerPath.contains("/helpers/")
                || lowerPath.contains("/common/") || lowerPath.contains("/shared/")) {
            addSignal(scores, reasons, "MODULE", 2.8, "Located in shared utilities/helpers package");
        }
    }

    private void addSignal(
            Map<String, Double> scores,
            Map<String, List<String>> reasons,
            String role,
            double weight,
            String reason
    ) {
        scores.merge(role, weight, Double::sum);
        List<String> list = reasons.get(role);
        if (list != null && !list.contains(reason)) {
            list.add(reason);
        }
    }

    private String pickTopRole(Map<String, Double> scores, String fallbackRole) {
        String bestRole = (fallbackRole != null && VALID_ROLES.contains(fallbackRole)) ? fallbackRole : "MODULE";
        double bestScore = -1.0;
        for (Map.Entry<String, Double> entry : scores.entrySet()) {
            if (entry.getValue() > bestScore) {
                bestScore = entry.getValue();
                bestRole = entry.getKey();
            }
        }
        return bestScore <= 0.0 ? "MODULE" : bestRole;
    }

    private double computeConfidence(Map<String, Double> scores, String bestRole) {
        List<Double> sorted = scores.values().stream()
                .sorted(Comparator.reverseOrder())
                .toList();
        double top = sorted.isEmpty() ? 0.0 : sorted.get(0);
        double second = sorted.size() > 1 ? sorted.get(1) : 0.0;
        if (top <= 0.8) {
            return 0.55;
        }
        double margin = (top - second) / Math.max(1.0, top);
        double magnitudeBonus = Math.min(0.25, top / 24.0);
        return Math.min(0.99, Math.max(0.45, 0.52 + margin * 0.28 + magnitudeBonus));
    }

    private Map<String, Double> computePageRank(
            List<SourceFileEntity> files,
            Map<String, Set<String>> outgoing,
            Map<String, Set<String>> incoming
    ) {
        int n = files.size();
        if (n == 0) {
            return Map.of();
        }
        double damping = 0.85;
        Map<String, Double> rank = new HashMap<>();
        double init = 1.0 / n;
        for (SourceFileEntity f : files) {
            rank.put(f.getPath(), init);
        }

        for (int iter = 0; iter < 25; iter++) {
            Map<String, Double> next = new HashMap<>();
            double danglingSum = 0.0;
            for (SourceFileEntity f : files) {
                if (outgoing.getOrDefault(f.getPath(), Set.of()).isEmpty()) {
                    danglingSum += rank.getOrDefault(f.getPath(), 0.0);
                }
            }
            double base = (1.0 - damping) / n + damping * (danglingSum / n);
            for (SourceFileEntity f : files) {
                String p = f.getPath();
                double sum = 0.0;
                // A file called/imported by important files receives higher centrality
                for (String caller : incoming.getOrDefault(p, Set.of())) {
                    int outDeg = Math.max(1, outgoing.getOrDefault(caller, Set.of()).size());
                    sum += rank.getOrDefault(caller, 0.0) / outDeg;
                }
                // Also reward orchestrator hubs that wire many modules together
                for (String callee : outgoing.getOrDefault(p, Set.of())) {
                    int inDeg = Math.max(1, incoming.getOrDefault(callee, Set.of()).size());
                    sum += 0.25 * (rank.getOrDefault(callee, 0.0) / inDeg);
                }
                next.put(p, base + damping * sum);
            }
            rank = next;
        }

        double max = rank.values().stream().mapToDouble(Double::doubleValue).max().orElse(1.0);
        if (max <= 0.0) {
            max = 1.0;
        }
        Map<String, Double> normalized = new LinkedHashMap<>();
        for (SourceFileEntity f : files) {
            normalized.put(f.getPath(), Math.min(1.0, rank.getOrDefault(f.getPath(), 0.0) / max));
        }
        return normalized;
    }

    /**
     * Tarjan's Strongly Connected Components algorithm to detect circular dependency chains.
     */
    private List<DependencyCycleDto> computeStronglyConnectedCycles(
            List<SourceFileEntity> files,
            Map<String, Set<String>> outgoing
    ) {
        Map<String, Integer> indexMap = new HashMap<>();
        Map<String, Integer> lowlinkMap = new HashMap<>();
        Deque<String> stack = new ArrayDeque<>();
        Set<String> onStack = new HashSet<>();
        List<DependencyCycleDto> cycles = new ArrayList<>();
        int[] indexCounter = {0};

        for (SourceFileEntity sf : files) {
            String v = sf.getPath();
            if (!indexMap.containsKey(v)) {
                tarjanDfs(v, outgoing, indexMap, lowlinkMap, stack, onStack, indexCounter, cycles);
            }
        }
        return cycles;
    }

    private void tarjanDfs(
            String v,
            Map<String, Set<String>> outgoing,
            Map<String, Integer> indexMap,
            Map<String, Integer> lowlinkMap,
            Deque<String> stack,
            Set<String> onStack,
            int[] indexCounter,
            List<DependencyCycleDto> cycles
    ) {
        indexMap.put(v, indexCounter[0]);
        lowlinkMap.put(v, indexCounter[0]);
        indexCounter[0]++;
        stack.push(v);
        onStack.add(v);

        for (String w : outgoing.getOrDefault(v, Set.of())) {
            if (!indexMap.containsKey(w)) {
                tarjanDfs(w, outgoing, indexMap, lowlinkMap, stack, onStack, indexCounter, cycles);
                lowlinkMap.put(v, Math.min(lowlinkMap.get(v), lowlinkMap.get(w)));
            } else if (onStack.contains(w)) {
                lowlinkMap.put(v, Math.min(lowlinkMap.get(v), indexMap.get(w)));
            }
        }

        if (Objects.equals(lowlinkMap.get(v), indexMap.get(v))) {
            List<String> component = new ArrayList<>();
            while (true) {
                String w = stack.pop();
                onStack.remove(w);
                component.add(w);
                if (w.equals(v)) {
                    break;
                }
            }
            if (component.size() >= 2) {
                Collections.reverse(component);
                cycles.add(new DependencyCycleDto(component));
            }
        }
    }

    private Map<String, Integer> computeTopologicalDepth(
            List<SourceFileEntity> files,
            Map<String, Set<String>> outgoing,
            Map<String, Set<String>> incoming,
            Map<String, String> roleByPath
    ) {
        Map<String, Integer> depth = new LinkedHashMap<>();
        Deque<String> queue = new ArrayDeque<>();

        for (SourceFileEntity sf : files) {
            String p = sf.getPath();
            String role = roleByPath.getOrDefault(p, "MODULE");
            boolean isEntry = incoming.getOrDefault(p, Set.of()).isEmpty()
                    || "UI_COMPONENT".equals(role)
                    || "CONTROLLER".equals(role);
            if (isEntry) {
                depth.put(p, 0);
                queue.add(p);
            }
        }

        int maxDepthCap = Math.max(8, files.size());
        while (!queue.isEmpty()) {
            String curr = queue.poll();
            int d = depth.getOrDefault(curr, 0);
            if (d >= maxDepthCap) {
                continue;
            }
            for (String next : outgoing.getOrDefault(curr, Set.of())) {
                if (!depth.containsKey(next)) {
                    depth.put(next, d + 1);
                    queue.add(next);
                }
            }
        }

        for (SourceFileEntity sf : files) {
            depth.putIfAbsent(sf.getPath(), LAYER_RANK.getOrDefault(roleByPath.get(sf.getPath()), 3));
        }
        return depth;
    }

    private record ClusterAssignment(
            List<ModuleClusterDto> clusters,
            Map<String, Integer> clusterByPath
    ) {}

    /**
     * Deterministic community / domain cluster discovery combining domain stem seeding
     * with undirected graph label propagation.
     */
    private ClusterAssignment computeModuleClusters(
            List<SourceFileEntity> files,
            Map<String, Set<String>> outgoing,
            Map<String, Set<String>> incoming,
            Map<String, String> roleByPath
    ) {
        if (files.isEmpty()) {
            return new ClusterAssignment(List.of(), Map.of());
        }

        Map<String, String> labelByPath = new LinkedHashMap<>();
        for (SourceFileEntity sf : files) {
            labelByPath.put(sf.getPath(), extractDomainStem(sf.getPath(), roleByPath.get(sf.getPath())));
        }

        // Undirected neighbors for community cohesion
        Map<String, Set<String>> neighbors = new HashMap<>();
        for (SourceFileEntity sf : files) {
            String p = sf.getPath();
            Set<String> nb = new LinkedHashSet<>();
            nb.addAll(outgoing.getOrDefault(p, Set.of()));
            nb.addAll(incoming.getOrDefault(p, Set.of()));
            neighbors.put(p, nb);
        }

        // 4 rounds of deterministic label propagation where weakly-named files adopt strong neighbor domain stems
        for (int iter = 0; iter < 4; iter++) {
            Map<String, String> nextLabels = new LinkedHashMap<>(labelByPath);
            for (SourceFileEntity sf : files) {
                String p = sf.getPath();
                Set<String> nbs = neighbors.getOrDefault(p, Set.of());
                if (nbs.isEmpty()) {
                    continue;
                }
                Map<String, Integer> freq = new LinkedHashMap<>();
                String selfLabel = labelByPath.get(p);
                // Keep strong domain stems sticky unless overwhelmed by neighbors
                freq.put(selfLabel, isGenericStem(selfLabel) ? 1 : 2);
                for (String nb : nbs) {
                    String nl = labelByPath.get(nb);
                    freq.merge(nl, 1, Integer::sum);
                }
                String best = selfLabel;
                int bestCount = -1;
                for (Map.Entry<String, Integer> e : freq.entrySet()) {
                    if (e.getValue() > bestCount || (e.getValue() == bestCount && !isGenericStem(e.getKey()) && isGenericStem(best))) {
                        bestCount = e.getValue();
                        best = e.getKey();
                    }
                }
                nextLabels.put(p, best);
            }
            labelByPath = nextLabels;
        }

        // Group by label and merge singleton clusters into their closest neighbor or role group
        Map<String, List<String>> grouped = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : labelByPath.entrySet()) {
            grouped.computeIfAbsent(e.getValue(), k -> new ArrayList<>()).add(e.getKey());
        }

        if (grouped.size() > 1) {
            List<String> singletonKeys = grouped.entrySet().stream()
                    .filter(e -> e.getValue().size() == 1)
                    .map(Map.Entry::getKey)
                    .toList();
            for (String key : singletonKeys) {
                List<String> memberList = grouped.get(key);
                if (memberList == null || memberList.isEmpty()) continue;
                String soloPath = memberList.get(0);
                String targetGroup = null;
                for (String nb : neighbors.getOrDefault(soloPath, Set.of())) {
                    String nbLabel = labelByPath.get(nb);
                    if (!nbLabel.equals(key) && grouped.containsKey(nbLabel)) {
                        targetGroup = nbLabel;
                        break;
                    }
                }
                if (targetGroup == null) {
                    // Fallback to largest group sharing the same architectural layer
                    String soloRole = roleByPath.getOrDefault(soloPath, "MODULE");
                    for (Map.Entry<String, List<String>> cand : grouped.entrySet()) {
                        if (!cand.getKey().equals(key) && cand.getValue().size() >= 2) {
                            boolean sharesRole = cand.getValue().stream()
                                    .anyMatch(p -> soloRole.equals(roleByPath.get(p)));
                            if (sharesRole) {
                                targetGroup = cand.getKey();
                                break;
                            }
                        }
                    }
                }
                if (targetGroup != null && grouped.containsKey(targetGroup)) {
                    grouped.get(targetGroup).add(soloPath);
                    labelByPath.put(soloPath, targetGroup);
                    grouped.remove(key);
                }
            }
        }

        List<Map.Entry<String, List<String>>> sortedGroups = new ArrayList<>(grouped.entrySet());
        sortedGroups.sort((a, b) -> Integer.compare(b.getValue().size(), a.getValue().size()));

        List<ModuleClusterDto> clusters = new ArrayList<>();
        Map<String, Integer> clusterByPath = new LinkedHashMap<>();
        int clusterId = 1;

        for (Map.Entry<String, List<String>> entry : sortedGroups) {
            int id = clusterId++;
            List<String> memberPaths = entry.getValue();
            Set<String> memberSet = new HashSet<>(memberPaths);
            for (String p : memberPaths) {
                clusterByPath.put(p, id);
            }

            int internalEdges = 0;
            int boundaryEdges = 0;
            Map<String, Integer> roleFreq = new LinkedHashMap<>();
            for (String p : memberPaths) {
                roleFreq.merge(roleByPath.getOrDefault(p, "MODULE"), 1, Integer::sum);
                for (String tgt : outgoing.getOrDefault(p, Set.of())) {
                    if (memberSet.contains(tgt)) {
                        internalEdges++;
                    } else {
                        boundaryEdges++;
                    }
                }
                for (String src : incoming.getOrDefault(p, Set.of())) {
                    if (!memberSet.contains(src)) {
                        boundaryEdges++;
                    }
                }
            }

            double denom = internalEdges * 2.0 + boundaryEdges;
            double cohesion = denom <= 0.0 ? 0.65 : round2(Math.min(1.0, (internalEdges * 2.0) / denom));
            String dominantRole = roleFreq.entrySet().stream()
                    .max(Map.Entry.comparingByValue())
                    .map(Map.Entry::getKey)
                    .orElse("MODULE");

            clusters.add(new ModuleClusterDto(
                    id,
                    humanizeClusterName(entry.getKey()),
                    memberPaths,
                    cohesion,
                    dominantRole
            ));
        }

        return new ClusterAssignment(clusters, clusterByPath);
    }

    private String extractDomainStem(String path, String role) {
        String normalized = path.replace('\\', '/');
        String[] segments = normalized.split("/");
        String fileName = stripExtension(segments[segments.length - 1]);

        // Strip common role suffixes from the class/file name to uncover the domain noun (e.g. OrderController -> order)
        String cleanedFile = fileName
                .replaceAll("(?i)(Controller|ServiceImpl|Service|JpaRepository|Repository|Entity|Model|Dto|Dtos|Request|Response|Client|Api|View|Page|Panel|Card|Node|Dialog|Form|Test|Tests|Config)$", "")
                .replaceAll("([a-z])([A-Z])", "$1_$2")
                .toLowerCase(Locale.ROOT);

        String[] tokens = cleanedFile.split("[_\\-.]+");
        for (String t : tokens) {
            if (t.length() >= 3 && !STOP_WORDS.contains(t)) {
                return singularize(t);
            }
        }

        // Otherwise check directory segments from deepest to shallowest
        for (int i = segments.length - 2; i >= 0; i--) {
            String seg = segments[i].toLowerCase(Locale.ROOT);
            if (seg.length() >= 3 && !STOP_WORDS.contains(seg)) {
                return singularize(seg);
            }
        }

        if ("UI_COMPONENT".equals(role) || "API_CLIENT".equals(role)) {
            return "frontend-ui";
        }
        if ("CONFIG".equals(role) || "TEST".equals(role)) {
            return "platform-config";
        }
        return "core-domain";
    }

    private boolean isGenericStem(String stem) {
        return "frontend-ui".equals(stem) || "platform-config".equals(stem) || "core-domain".equals(stem);
    }

    private String humanizeClusterName(String stem) {
        String[] parts = stem.split("[_\\-]+");
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (p.isBlank()) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(Character.toUpperCase(p.charAt(0))).append(p.substring(1));
        }
        return sb.length() == 0 ? "Core Module" : sb.append(" Module").toString();
    }

    private List<LayerViolationDto> detectLayerViolations(
            List<DependencyEdgeEntity> cleanEdges,
            Map<String, String> roleByPath
    ) {
        List<LayerViolationDto> violations = new ArrayList<>();
        boolean hasServiceLayer = roleByPath.values().stream().anyMatch("SERVICE"::equals);

        for (DependencyEdgeEntity edge : cleanEdges) {
            String src = edge.getSourceFilePath();
            String tgt = edge.getTargetFilePath();
            String srcRole = roleByPath.getOrDefault(src, "MODULE");
            String tgtRole = roleByPath.getOrDefault(tgt, "MODULE");

            Integer srcRank = LAYER_RANK.get(srcRole);
            Integer tgtRank = LAYER_RANK.get(tgtRole);
            if (srcRank == null || tgtRank == null || srcRole.equals(tgtRole)) {
                continue;
            }

            // Upward dependency inversion (e.g. REPOSITORY -> SERVICE, SERVICE -> CONTROLLER, MODEL -> SERVICE/REPOSITORY)
            if (srcRank > tgtRank) {
                // Allow MODEL -> MODEL, but MODEL depending on SERVICE/CONTROLLER/REPOSITORY is a strict violation
                violations.add(new LayerViolationDto(
                        src,
                        tgt,
                        srcRole,
                        tgtRole,
                        "Upward layer inversion: " + srcRole + " (" + extractSimpleFilename(src)
                                + ") depends on higher-level " + tgtRole + " (" + extractSimpleFilename(tgt) + ")"
                ));
            } else if ("CONTROLLER".equals(srcRole) && "REPOSITORY".equals(tgtRole) && hasServiceLayer) {
                violations.add(new LayerViolationDto(
                        src,
                        tgt,
                        srcRole,
                        tgtRole,
                        "Layer bypass: Controller (" + extractSimpleFilename(src)
                                + ") accesses Repository (" + extractSimpleFilename(tgt) + ") directly, bypassing Service layer"
                ));
            } else if ("UI_COMPONENT".equals(srcRole) && ("REPOSITORY".equals(tgtRole) || "SERVICE".equals(tgtRole))) {
                violations.add(new LayerViolationDto(
                        src,
                        tgt,
                        srcRole,
                        tgtRole,
                        "Layer bypass: UI Component (" + extractSimpleFilename(src)
                                + ") couples directly to backend " + tgtRole + " (" + extractSimpleFilename(tgt) + ")"
                ));
            }
        }
        return violations;
    }

    /**
     * Infers missing database ER relationships by analyzing FK naming conventions (`*_id`, `*Id`, `*_fk`),
     * entity name stems (singular/plural), and implicit join tables.
     */
    List<InferredErRelationDto> inferErRelationsAlgorithmically(ErDiagramDto erDiagram) {
        if (erDiagram == null || erDiagram.entities() == null || erDiagram.entities().size() < 2) {
            return List.of();
        }

        List<ErEntityDto> entities = erDiagram.entities();
        List<ErRelationDto> existing = erDiagram.relations() != null ? erDiagram.relations() : List.of();

        Set<String> existingPairs = new HashSet<>();
        for (ErRelationDto r : existing) {
            existingPairs.add(r.source() + "<->" + r.target());
            existingPairs.add(r.target() + "<->" + r.source());
        }

        // Map normalized entity keys (table name, singular table name, class name) -> ErEntityDto
        Map<String, ErEntityDto> entityByStem = new LinkedHashMap<>();
        for (ErEntityDto e : entities) {
            registerEntityStems(entityByStem, e);
        }

        List<InferredErRelationDto> inferred = new ArrayList<>();
        int seq = 1;

        // Pass 1: Foreign-key column naming conventions (e.g. customer_id, orderId, user_fk)
        Map<String, List<ErEntityDto>> entityFkTargets = new LinkedHashMap<>();
        for (ErEntityDto source : entities) {
            List<ErEntityDto> referencedBySource = new ArrayList<>();
            for (ErColumnDto col : source.columns()) {
                if (col.primaryKey() && ("id".equalsIgnoreCase(col.name()) || "uuid".equalsIgnoreCase(col.name()))) {
                    continue;
                }
                ErEntityDto target = matchColumnToTargetEntity(source, col, entityByStem);
                if (target != null && !target.id().equals(source.id())) {
                    referencedBySource.add(target);
                    String pairKey = source.id() + "<->" + target.id();
                    if (existingPairs.add(pairKey)) {
                        existingPairs.add(target.id() + "<->" + source.id());
                        double conf = col.foreignKey() ? 0.94 : 0.84;
                        String evidence = "Column " + source.tableName() + "." + col.name()
                                + " (" + col.sqlType() + ") matches entity table '" + target.tableName() + "' by FK naming convention";
                        inferred.add(new InferredErRelationDto(
                                "inferred-er-" + (seq++),
                                source.id(),
                                target.id(),
                                "MANY_TO_ONE",
                                col.fieldName() != null ? col.fieldName() : col.name(),
                                col.name(),
                                null,
                                conf,
                                evidence,
                                "algorithm"
                        ));
                    }
                }
            }
            entityFkTargets.put(source.id(), referencedBySource);
        }

        // Pass 2: Implicit Join Table detection (table with >= 2 FK-like columns pointing to distinct entities and few extra columns)
        for (ErEntityDto joinCandidate : entities) {
            List<ErEntityDto> targets = entityFkTargets.getOrDefault(joinCandidate.id(), List.of());
            // Also include any already-declared MANY_TO_ONE relations from joinCandidate
            for (ErRelationDto r : existing) {
                if (r.source().equals(joinCandidate.id()) && "MANY_TO_ONE".equals(r.type())) {
                    entities.stream()
                            .filter(e -> e.id().equals(r.target()))
                            .findFirst()
                            .ifPresent(targets::add);
                }
            }
            List<ErEntityDto> distinctTargets = targets.stream()
                    .filter(t -> !t.id().equals(joinCandidate.id()))
                    .collect(Collectors.collectingAndThen(
                            Collectors.toMap(ErEntityDto::id, t -> t, (a, b) -> a, LinkedHashMap::new),
                            m -> new ArrayList<>(m.values())
                    ));

            if (distinctTargets.size() == 2 && joinCandidate.columns().size() <= 6) {
                ErEntityDto left = distinctTargets.get(0);
                ErEntityDto right = distinctTargets.get(1);
                String pairKey = left.id() + "<->" + right.id();
                if (existingPairs.add(pairKey)) {
                    existingPairs.add(right.id() + "<->" + left.id());
                    inferred.add(new InferredErRelationDto(
                            "inferred-er-" + (seq++),
                            left.id(),
                            right.id(),
                            "MANY_TO_MANY",
                            joinCandidate.tableName(),
                            null,
                            joinCandidate.tableName(),
                            0.86,
                            "Table '" + joinCandidate.tableName() + "' acts as an associative join table linking '"
                                    + left.tableName() + "' and '" + right.tableName() + "'",
                            "algorithm"
                    ));
                }
            }
        }

        return inferred;
    }

    private void registerEntityStems(Map<String, ErEntityDto> map, ErEntityDto entity) {
        String tableNorm = normalizeStem(entity.tableName());
        String classNorm = normalizeStem(
                entity.className().replaceAll("(?i)(Entity|Model|Table|Record|Schema)$", "")
        );
        if (!tableNorm.isBlank()) {
            map.putIfAbsent(tableNorm, entity);
            map.putIfAbsent(singularize(tableNorm), entity);
        }
        if (!classNorm.isBlank()) {
            map.putIfAbsent(classNorm, entity);
            map.putIfAbsent(singularize(classNorm), entity);
        }
    }

    private ErEntityDto matchColumnToTargetEntity(
            ErEntityDto source,
            ErColumnDto col,
            Map<String, ErEntityDto> entityByStem
    ) {
        // 1. Explicit references string if present
        if (col.references() != null && !col.references().isBlank()) {
            String refTable = col.references().split("\\.")[0];
            ErEntityDto byRef = entityByStem.get(normalizeStem(refTable));
            if (byRef == null) {
                byRef = entityByStem.get(singularize(normalizeStem(refTable)));
            }
            if (byRef != null && !byRef.id().equals(source.id())) {
                return byRef;
            }
        }

        // 2. Column name ending with _id, _fk, _uuid, _code or camelCase Id/Fk
        String colName = col.name() != null ? col.name() : "";
        String candidatePrefix = extractFkPrefix(colName);
        if (candidatePrefix == null && col.fieldName() != null) {
            candidatePrefix = extractFkPrefix(col.fieldName());
        }
        if (candidatePrefix != null && !candidatePrefix.isBlank()) {
            String norm = normalizeStem(candidatePrefix);
            ErEntityDto match = entityByStem.get(norm);
            if (match == null) {
                match = entityByStem.get(singularize(norm));
            }
            if (match != null && !match.id().equals(source.id())) {
                return match;
            }
        }

        // 3. Field javaType matching an entity class name
        if (col.javaType() != null && !col.javaType().isBlank()) {
            String cleanType = col.javaType()
                    .replaceAll(".*<\\s*([A-Za-z0-9_]+)\\s*>.*", "$1")
                    .replaceAll("(?i)(Entity|Model|Dto)$", "");
            String normType = normalizeStem(cleanType);
            ErEntityDto match = entityByStem.get(normType);
            if (match == null) {
                match = entityByStem.get(singularize(normType));
            }
            if (match != null && !match.id().equals(source.id())) {
                return match;
            }
        }

        return null;
    }

    private String extractFkPrefix(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String suffix : List.of("_id", "_fk", "_uuid", "_key", "_code")) {
            if (lower.endsWith(suffix) && lower.length() > suffix.length() + 1) {
                return lower.substring(0, lower.length() - suffix.length());
            }
        }
        if (name.matches(".*[a-z0-9](Id|Fk|Uuid)$") && name.length() > 3) {
            return name.replaceAll("(Id|Fk|Uuid)$", "");
        }
        return null;
    }

    private String normalizeStem(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("([a-z0-9])([A-Z])", "$1_$2")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
    }

    private String singularize(String word) {
        if (word == null || word.length() <= 3) return word != null ? word : "";
        if (word.endsWith("ies") && word.length() > 4) {
            return word.substring(0, word.length() - 3) + "y";
        }
        if (word.endsWith("sses") || word.endsWith("xes") || word.endsWith("ches") || word.endsWith("shes")) {
            return word.substring(0, word.length() - 2);
        }
        if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
            return word.substring(0, word.length() - 1);
        }
        return word;
    }

    private String resolveOllamaModel(String modelOverride, List<String> availableModels, List<String> warnings) {
        if (modelOverride != null && !modelOverride.isBlank()) {
            String req = modelOverride.trim();
            if (availableModels.contains(req)) {
                return req;
            }
        }
        if (availableModels.contains(defaultChatModel)) {
            return defaultChatModel;
        }
        // Pick first non-embedding model if available
        for (String m : availableModels) {
            String lower = m.toLowerCase(Locale.ROOT);
            if (!lower.contains("embed") && !lower.contains("minilm") && !lower.contains("bge-")) {
                warnings.add("Configured model '" + defaultChatModel + "' not installed; used available local model '" + m + "'.");
                return m;
            }
        }
        return availableModels.get(0);
    }

    private boolean refineFilesWithOllama(
            RepositoryEntity repo,
            List<SourceFileEntity> files,
            String activeModel,
            Map<String, Double> pageRank,
            Map<String, Double> confidenceByPath,
            Map<String, String> finalRoleByPath,
            Map<String, List<String>> topReasonsByPath,
            Map<String, String> summaryByPath,
            Map<String, List<SymbolInfoDto>> symbolsByPath,
            Map<String, Set<String>> outgoing
    ) throws Exception {
        // Prioritize most important or lower-confidence files (up to 30 files per batch, max 60 total for snappy UX)
        List<SourceFileEntity> prioritized = new ArrayList<>(files);
        prioritized.sort((a, b) -> {
            double scoreA = pageRank.getOrDefault(a.getPath(), 0.0) + (1.0 - confidenceByPath.getOrDefault(a.getPath(), 0.5));
            double scoreB = pageRank.getOrDefault(b.getPath(), 0.0) + (1.0 - confidenceByPath.getOrDefault(b.getPath(), 0.5));
            return Double.compare(scoreB, scoreA);
        });
        if (prioritized.size() > 50) {
            prioritized = prioritized.subList(0, 50);
        }

        int batchSize = 25;
        boolean anyUpdated = false;

        for (int start = 0; start < prioritized.size(); start += batchSize) {
            List<SourceFileEntity> batch = prioritized.subList(start, Math.min(prioritized.size(), start + batchSize));
            StringBuilder prompt = new StringBuilder();
            prompt.append("Repository: ").append(repo.getOwner()).append("/").append(repo.getName()).append("\n");
            prompt.append("Classify each file below into its exact architectural role and write a concise 1-sentence summary of its responsibility.\n");
            prompt.append("Allowed roles: UI_COMPONENT, API_CLIENT, CONTROLLER, SERVICE, REPOSITORY, MODEL, MODULE, CONFIG, TEST.\n\n");

            for (SourceFileEntity sf : batch) {
                String p = sf.getPath();
                List<String> syms = symbolsByPath.getOrDefault(p, List.of()).stream()
                        .map(SymbolInfoDto::name)
                        .limit(6)
                        .toList();
                Set<String> deps = outgoing.getOrDefault(p, Set.of()).stream()
                        .map(this::extractSimpleFilename)
                        .limit(6)
                        .collect(Collectors.toCollection(LinkedHashSet::new));

                prompt.append("FILE: ").append(p)
                        .append(" | lang=").append(sf.getLanguage())
                        .append(" | algoRole=").append(finalRoleByPath.get(p))
                        .append(" | symbols=").append(syms)
                        .append(" | calls=").append(deps)
                        .append("\n");
                String preview = extractFirstMeaningfulLines(sf.getContent(), 12);
                if (!preview.isBlank()) {
                    prompt.append(preview).append("\n");
                }
                prompt.append("---\n");
            }

            Map<String, Object> itemSchema = Map.of(
                    "type", "object",
                    "properties", Map.of(
                            "path", Map.of("type", "string"),
                            "role", Map.of("type", "string", "enum", new ArrayList<>(VALID_ROLES)),
                            "confidence", Map.of("type", "number"),
                            "summary", Map.of("type", "string")
                    ),
                    "required", List.of("path", "role", "confidence", "summary")
            );
            Map<String, Object> schema = Map.of(
                    "type", "object",
                    "properties", Map.of(
                            "files", Map.of("type", "array", "items", itemSchema)
                    ),
                    "required", List.of("files")
            );

            JsonNode root = callOllamaStructured(
                    activeModel,
                    "You are a software architecture classifier. Return strict JSON matching the schema.",
                    prompt.toString(),
                    schema
            );

            JsonNode filesNode = root.path("files");
            if (filesNode.isArray()) {
                for (JsonNode item : filesNode) {
                    String path = item.path("path").asText("").trim();
                    String aiRole = item.path("role").asText("").trim().toUpperCase(Locale.ROOT);
                    double aiConf = Math.min(0.99, Math.max(0.5, item.path("confidence").asDouble(0.85)));
                    String aiSummary = item.path("summary").asText("").trim();

                    if (!finalRoleByPath.containsKey(path) || !VALID_ROLES.contains(aiRole)) {
                        continue;
                    }

                    String algoRole = finalRoleByPath.get(path);
                    double algoConf = confidenceByPath.getOrDefault(path, 0.75);

                    // Fuse AI role with algorithmic role: if AI agrees, boost confidence; if AI overrides a lower-confidence algo role, adopt AI role
                    if (aiRole.equals(algoRole)) {
                        confidenceByPath.put(path, Math.min(0.99, Math.max(algoConf, aiConf) + 0.06));
                    } else if (aiConf >= algoConf - 0.08) {
                        finalRoleByPath.put(path, aiRole);
                        confidenceByPath.put(path, round2((aiConf * 0.65) + (algoConf * 0.35)));
                    }

                    List<String> reasons = new ArrayList<>(topReasonsByPath.getOrDefault(path, List.of()));
                    reasons.add(0, "Ollama (" + activeModel + ") verified role as " + finalRoleByPath.get(path));
                    if (reasons.size() > 4) {
                        reasons = reasons.subList(0, 4);
                    }
                    topReasonsByPath.put(path, reasons);

                    if (!aiSummary.isBlank() && aiSummary.length() >= 12) {
                        summaryByPath.put(path, aiSummary);
                    }
                    anyUpdated = true;
                }
            }
        }

        return anyUpdated;
    }

    private List<InferredErRelationDto> inferErRelationsWithOllama(
            RepositoryEntity repo,
            ErDiagramDto erDiagram,
            List<InferredErRelationDto> algoInferred,
            String activeModel
    ) throws Exception {
        Map<String, ErEntityDto> entityById = erDiagram.entities().stream()
                .collect(Collectors.toMap(ErEntityDto::id, e -> e, (a, b) -> a, LinkedHashMap::new));

        Set<String> existingPairs = new HashSet<>();
        for (ErRelationDto r : erDiagram.relations()) {
            existingPairs.add(r.source() + "<->" + r.target());
            existingPairs.add(r.target() + "<->" + r.source());
        }
        for (InferredErRelationDto r : algoInferred) {
            existingPairs.add(r.source() + "<->" + r.target());
            existingPairs.add(r.target() + "<->" + r.source());
        }

        StringBuilder sb = new StringBuilder();
        sb.append("Repository: ").append(repo.getOwner()).append("/").append(repo.getName()).append("\n");
        sb.append("Analyze the database entities and columns below and infer any MISSING foreign-key or semantic relationships between tables.\n");
        sb.append("Use the exact entity `id` values for `source` and `target`.\n\n");
        for (ErEntityDto e : erDiagram.entities()) {
            sb.append("ENTITY id=\"").append(e.id()).append("\" table=\"").append(e.tableName()).append("\": ");
            sb.append(e.columns().stream()
                    .map(c -> c.name() + ":" + c.sqlType() + (c.primaryKey() ? "(PK)" : "") + (c.foreignKey() ? "(FK)" : ""))
                    .collect(Collectors.joining(", ")));
            sb.append("\n");
        }

        Map<String, Object> relSchema = Map.of(
                "type", "object",
                "properties", Map.of(
                        "source", Map.of("type", "string"),
                        "target", Map.of("type", "string"),
                        "type", Map.of("type", "string", "enum", new ArrayList<>(VALID_ER_TYPES)),
                        "fieldName", Map.of("type", "string"),
                        "confidence", Map.of("type", "number"),
                        "evidence", Map.of("type", "string")
                ),
                "required", List.of("source", "target", "type", "fieldName", "confidence", "evidence")
        );
        Map<String, Object> schema = Map.of(
                "type", "object",
                "properties", Map.of(
                        "relations", Map.of("type", "array", "items", relSchema)
                ),
                "required", List.of("relations")
        );

        JsonNode root = callOllamaStructured(
                activeModel,
                "You are a database architect. Infer missing ER relationships using only valid entity ids from the prompt.",
                sb.toString(),
                schema
        );

        List<InferredErRelationDto> results = new ArrayList<>();
        JsonNode rels = root.path("relations");
        int seq = 1;
        if (rels.isArray()) {
            for (JsonNode r : rels) {
                String src = r.path("source").asText("").trim();
                String tgt = r.path("target").asText("").trim();
                String type = r.path("type").asText("MANY_TO_ONE").trim().toUpperCase(Locale.ROOT);
                String fieldName = r.path("fieldName").asText("").trim();
                double conf = round2(Math.min(0.98, Math.max(0.55, r.path("confidence").asDouble(0.82))));
                String evidence = r.path("evidence").asText("Inferred by Ollama AI schema analysis").trim();

                if (src.equals(tgt) || !entityById.containsKey(src) || !entityById.containsKey(tgt)) {
                    continue;
                }
                if (!VALID_ER_TYPES.contains(type)) {
                    type = "MANY_TO_ONE";
                }
                String pairKey = src + "<->" + tgt;
                if (existingPairs.add(pairKey)) {
                    existingPairs.add(tgt + "<->" + src);
                    results.add(new InferredErRelationDto(
                            "ollama-er-" + (seq++),
                            src,
                            tgt,
                            type,
                            fieldName.isBlank() ? tgt : fieldName,
                            fieldName.isBlank() ? null : fieldName,
                            null,
                            conf,
                            evidence,
                            "ollama"
                    ));
                }
            }
        }
        return results;
    }

    private record ArchNarrative(String architectureStyle, String overview) {}

    private ArchNarrative generateArchitectureNarrativeWithOllama(
            RepositoryEntity repo,
            int fileCount,
            int edgeCount,
            Map<String, String> roleByPath,
            List<ModuleClusterDto> clusters,
            String activeModel
    ) throws Exception {
        Map<String, Long> roleCounts = roleByPath.values().stream()
                .collect(Collectors.groupingBy(r -> r, LinkedHashMap::new, Collectors.counting()));
        List<String> clusterNames = clusters.stream().map(ModuleClusterDto::name).limit(6).toList();

        String prompt = "Repository: " + repo.getOwner() + "/" + repo.getName() + "\n"
                + "Files: " + fileCount + ", Dependencies: " + edgeCount + "\n"
                + "Role distribution: " + roleCounts + "\n"
                + "Module clusters: " + clusterNames + "\n"
                + "Summarize the architectureStyle (short phrase, e.g. 'Full-Stack Layered Architecture (React + Spring REST + JPA)') "
                + "and overview (2-3 crisp sentences explaining how requests and data flow through the modules).";

        Map<String, Object> schema = Map.of(
                "type", "object",
                "properties", Map.of(
                        "architectureStyle", Map.of("type", "string"),
                        "overview", Map.of("type", "string")
                ),
                "required", List.of("architectureStyle", "overview")
        );

        JsonNode root = callOllamaStructured(
                activeModel,
                "You are a principal software architect. Respond with strict JSON.",
                prompt,
                schema
        );
        String style = root.path("architectureStyle").asText("").trim();
        String overview = root.path("overview").asText("").trim();
        if (style.isBlank() || overview.isBlank()) {
            return null;
        }
        return new ArchNarrative(style, overview);
    }

    private JsonNode callOllamaStructured(
            String model,
            String systemPrompt,
            String userPrompt,
            Map<String, Object> jsonSchema
    ) throws Exception {
        Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", model);
        requestBody.put("stream", false);
        requestBody.put("format", jsonSchema);
        requestBody.put("options", Map.of("temperature", 0.1));
        requestBody.put("messages", List.of(
                Map.of("role", "system", "content", systemPrompt),
                Map.of("role", "user", "content", userPrompt)
        ));

        String rawResponse = ollamaRestClient.post()
                .uri(URI.create(ollamaBaseUrl + "/api/chat"))
                .contentType(MediaType.APPLICATION_JSON)
                .body(requestBody)
                .retrieve()
                .body(String.class);

        JsonNode chatRoot = objectMapper.readTree(rawResponse);
        String content = chatRoot.path("message").path("content").asText("");
        content = content.replaceAll("(?s)<think>.*?</think>", "").trim();
        int firstBrace = content.indexOf('{');
        int lastBrace = content.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            content = content.substring(firstBrace, lastBrace + 1);
        }
        return objectMapper.readTree(content);
    }

    private ArchNarrative buildDeterministicNarrative(
            RepositoryEntity repo,
            int fileCount,
            int edgeCount,
            Map<String, String> roleByPath,
            List<ModuleClusterDto> clusters,
            int cycleCount,
            int violationCount,
            int tableCount,
            int inferredErCount
    ) {
        Map<String, Long> counts = roleByPath.values().stream()
                .collect(Collectors.groupingBy(r -> r, Collectors.counting()));

        boolean hasUi = counts.getOrDefault("UI_COMPONENT", 0L) + counts.getOrDefault("API_CLIENT", 0L) > 0;
        boolean hasController = counts.getOrDefault("CONTROLLER", 0L) > 0;
        boolean hasService = counts.getOrDefault("SERVICE", 0L) > 0;
        boolean hasRepo = counts.getOrDefault("REPOSITORY", 0L) > 0;
        boolean hasModel = counts.getOrDefault("MODEL", 0L) > 0;

        String style;
        if (hasUi && hasController && hasService && hasRepo) {
            style = "Full-Stack Layered Architecture (UI → API Bridge → Controller → Service → Repository → Model)";
        } else if (hasController && hasService && hasRepo) {
            style = "Layered Service & Data Architecture (Controller → Service → Repository → Model)";
        } else if (hasUi && !hasController) {
            style = "Modular Frontend Component Architecture";
        } else if (hasService && hasModel) {
            style = "Domain-Driven Service & Model Pipeline";
        } else {
            style = "Modular Polyglot Codebase (" + clusters.size() + " domain clusters)";
        }

        String topClusters = clusters.stream()
                .limit(3)
                .map(c -> c.name() + " (" + c.files().size() + " files)")
                .collect(Collectors.joining(", "));

        StringBuilder overview = new StringBuilder();
        overview.append(repo.getOwner()).append("/").append(repo.getName())
                .append(" comprises ").append(fileCount).append(" indexed files connected by ")
                .append(edgeCount).append(" verified dependency links");
        if (!topClusters.isBlank()) {
            overview.append(" across ").append(clusters.size())
                    .append(" cohesive domain clusters (").append(topClusters).append(")");
        }
        overview.append(". ");

        if (tableCount > 0) {
            overview.append("The persistence schema models ").append(tableCount).append(" database tables");
            if (inferredErCount > 0) {
                overview.append(" with ").append(inferredErCount)
                        .append(" additional foreign-key/join relationships discovered via deep analysis");
            }
            overview.append(". ");
        }

        if (cycleCount == 0 && violationCount == 0) {
            overview.append("All dependencies flow cleanly top-to-bottom with zero circular dependencies or layer inversions.");
        } else {
            overview.append("Deep graph analysis flagged ").append(cycleCount)
                    .append(" circular dependency group(s) and ").append(violationCount)
                    .append(" architectural layer violation(s) for review.");
        }

        return new ArchNarrative(style, overview.toString());
    }

    private String buildDeterministicFileSummary(
            SourceFileEntity sf,
            String role,
            List<SymbolInfoDto> symbols,
            int fanIn,
            int fanOut
    ) {
        String simple = stripExtension(extractSimpleFilename(sf.getPath()));
        String humanized = simple.replaceAll("([a-z0-9])([A-Z])", "$1 $2")
                .replaceAll("[_\\-]+", " ")
                .trim();

        String topSyms = symbols.stream()
                .map(SymbolInfoDto::name)
                .filter(n -> !n.equalsIgnoreCase(simple))
                .limit(3)
                .collect(Collectors.joining(", "));

        String symSuffix = topSyms.isBlank() ? "" : " (" + topSyms + ")";
        String rolePrefix = switch (role) {
            case "UI_COMPONENT" -> "Interactive UI view/component for " + humanized;
            case "API_CLIENT" -> "Frontend client/state module bridging " + humanized;
            case "CONTROLLER" -> "HTTP API entrypoint routing requests for " + humanized;
            case "SERVICE" -> "Core business service orchestrating " + humanized;
            case "REPOSITORY" -> "Data access repository persisting and querying " + humanized;
            case "MODEL" -> "Domain model / data schema defining " + humanized;
            case "CONFIG" -> "Configuration & infrastructure wiring for " + humanized;
            case "TEST" -> "Automated verification suite testing " + humanized;
            default -> "Shared module providing utilities for " + humanized;
        };

        return rolePrefix + symSuffix + " · " + fanIn + " callers, " + fanOut + " dependencies.";
    }

    private String extractFirstMeaningfulLines(String content, int maxLines) {
        if (content == null || content.isBlank()) return "";
        String[] lines = content.split("\n");
        StringBuilder sb = new StringBuilder();
        int count = 0;
        for (String line : lines) {
            String t = line.trim();
            if (t.isEmpty() || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("package ")) {
                continue;
            }
            sb.append("  ").append(t.length() > 110 ? t.substring(0, 110) + "..." : t).append("\n");
            if (++count >= maxLines) break;
        }
        return sb.toString();
    }

    private List<SymbolInfoDto> parseSymbols(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<SymbolInfoDto>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private String extractSimpleFilename(String path) {
        if (path == null) return "";
        int idx = path.lastIndexOf('/');
        return idx >= 0 ? path.substring(idx + 1) : path;
    }

    private String stripExtension(String filename) {
        int idx = filename.lastIndexOf('.');
        return idx > 0 ? filename.substring(0, idx) : filename;
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
