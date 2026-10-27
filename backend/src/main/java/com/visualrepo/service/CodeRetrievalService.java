package com.visualrepo.service;

import com.visualrepo.model.CodeChunkEntity;
import com.visualrepo.model.DependencyEdgeEntity;
import com.visualrepo.model.RepositoryEntity;
import com.visualrepo.model.RetrievalMode;
import com.visualrepo.repository.CodeChunkJpaRepository;
import com.visualrepo.repository.DependencyEdgeJpaRepository;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class CodeRetrievalService {

    private static final int TOP_K_CHUNKS = 8;

    private static final Set<String> STOP_WORDS = Set.of(
            "the", "and", "for", "how", "what", "where", "when", "why", "who", "which",
            "does", "are", "is", "in", "to", "of", "from", "with", "this", "that", "can", "explain", "show"
    );

    private final CodeChunkJpaRepository chunkRepository;
    private final DependencyEdgeJpaRepository edgeRepository;
    private final EmbeddingService embeddingService;

    public CodeRetrievalService(
            CodeChunkJpaRepository chunkRepository,
            DependencyEdgeJpaRepository edgeRepository,
            EmbeddingService embeddingService
    ) {
        this.chunkRepository = chunkRepository;
        this.edgeRepository = edgeRepository;
        this.embeddingService = embeddingService;
    }

    public record ScoredChunk(
            CodeChunkEntity chunk,
            double lexicalScore,
            double vectorScore,
            double combinedScore
    ) {}

    public record RetrievalBundle(
            RetrievalMode modeUsed,
            List<ScoredChunk> topChunks
    ) {}

    public RetrievalBundle retrieveRelevantChunks(
            RepositoryEntity repo,
            String question,
            String requestedMode
    ) {
        List<CodeChunkEntity> allChunks = chunkRepository.findByRepositoryIdOrderByFilePathAscStartLineAsc(repo.getId());
        if (allChunks.isEmpty()) {
            return new RetrievalBundle(RetrievalMode.BASIC_INDEX, List.of());
        }

        boolean useVectorHybrid = repo.isEmbeddingsGenerated()
                && !"BASIC_INDEX".equalsIgnoreCase(requestedMode);

        List<String> queryTokens = tokenizeQuery(question);
        float[] queryEmbedding = null;
        if (useVectorHybrid) {
            queryEmbedding = embeddingService.embedText(question).vector();
        }

        // First pass: score each chunk by lexical/symbol rules + optional vector similarity
        Map<Long, Double> lexicalScores = new HashMap<>();
        Map<Long, Double> vectorScores = new HashMap<>();
        double maxLexical = 1e-6;

        for (CodeChunkEntity chunk : allChunks) {
            double lex = computeBasicIndexScore(chunk, queryTokens, question);
            lexicalScores.put(chunk.getId(), lex);
            if (lex > maxLexical) {
                maxLexical = lex;
            }

            if (useVectorHybrid && chunk.getEmbeddingJson() != null) {
                float[] chunkVec = embeddingService.deserializeVector(chunk.getEmbeddingJson());
                double cos = embeddingService.cosineSimilarity(queryEmbedding, chunkVec);
                vectorScores.put(chunk.getId(), Math.max(0.0, cos));
            } else {
                vectorScores.put(chunk.getId(), 0.0);
            }
        }

        // Dependency graph boost: if a file has a strong match, slightly boost its direct dependency targets
        final double finalMaxLexical = maxLexical;
        List<DependencyEdgeEntity> edges = edgeRepository.findByRepositoryId(repo.getId());
        Set<String> highScoringFiles = allChunks.stream()
                .filter(c -> lexicalScores.getOrDefault(c.getId(), 0.0) >= finalMaxLexical * 0.65)
                .map(CodeChunkEntity::getFilePath)
                .collect(Collectors.toSet());

        Set<String> neighborFiles = edges.stream()
                .filter(e -> highScoringFiles.contains(e.getSourceFilePath()) || highScoringFiles.contains(e.getTargetFilePath()))
                .flatMap(e -> java.util.stream.Stream.of(e.getSourceFilePath(), e.getTargetFilePath()))
                .collect(Collectors.toSet());

        List<ScoredChunk> scored = new ArrayList<>();
        for (CodeChunkEntity chunk : allChunks) {
            double normalizedLex = lexicalScores.getOrDefault(chunk.getId(), 0.0) / maxLexical;
            if (neighborFiles.contains(chunk.getFilePath())) {
                normalizedLex = Math.min(1.0, normalizedLex + 0.12);
            }
            double vec = vectorScores.getOrDefault(chunk.getId(), 0.0);
            double combined = useVectorHybrid
                    ? (0.55 * vec + 0.45 * normalizedLex)
                    : normalizedLex;

            scored.add(new ScoredChunk(chunk, normalizedLex, vec, combined));
        }

        scored.sort(Comparator.comparingDouble(ScoredChunk::combinedScore).reversed());
        List<ScoredChunk> topK = scored.stream()
                .limit(TOP_K_CHUNKS)
                .toList();

        return new RetrievalBundle(
                useVectorHybrid ? RetrievalMode.VECTOR_HYBRID : RetrievalMode.BASIC_INDEX,
                topK
        );
    }

    private double computeBasicIndexScore(CodeChunkEntity chunk, List<String> queryTokens, String rawQuestion) {
        double score = 0.1; // base score so even broad architectural questions return entry chunks
        String lowerPath = chunk.getFilePath().toLowerCase(Locale.ROOT);
        String lowerSymbol = chunk.getSymbolName().toLowerCase(Locale.ROOT);
        String lowerContent = chunk.getContent().toLowerCase(Locale.ROOT);
        String lowerQuestion = rawQuestion.toLowerCase(Locale.ROOT);

        // Boost architectural entry points for general architecture/flow questions
        if (lowerQuestion.contains("architecture") || lowerQuestion.contains("overview") || lowerQuestion.contains("flow")) {
            if (lowerPath.contains("controller") || lowerPath.contains("service") || lowerPath.contains("app.")) {
                score += 1.5;
            }
        }

        for (String token : queryTokens) {
            if (lowerSymbol.equals(token) || lowerSymbol.equals(token + "()")) {
                score += 5.0;
            } else if (lowerSymbol.contains(token)) {
                score += 3.0;
            }

            if (lowerPath.contains(token)) {
                score += 2.5;
            }

            int occurrences = countOccurrences(lowerContent, token);
            if (occurrences > 0) {
                score += 1.2 * (1.0 + Math.log1p(occurrences));
            }
        }

        // Prefer substantive method/class chunks over pure import headers unless imports are asked
        if ("FILE_HEADER".equals(chunk.getChunkType()) && !lowerQuestion.contains("import")) {
            score *= 0.55;
        }

        return score;
    }

    private List<String> tokenizeQuery(String question) {
        if (question == null || question.isBlank()) {
            return List.of();
        }
        // Split both whitespace/punctuation and camelCase tokens
        String expanded = question.replaceAll("([a-z])([A-Z])", "$1 $2");
        String[] raw = expanded.toLowerCase(Locale.ROOT).split("[^a-z0-9_]+");
        List<String> tokens = new ArrayList<>();
        for (String r : raw) {
            if (r.length() >= 2 && !STOP_WORDS.contains(r)) {
                tokens.add(r);
            }
        }
        return tokens;
    }

    private int countOccurrences(String text, String sub) {
        int count = 0;
        int idx = 0;
        while ((idx = text.indexOf(sub, idx)) != -1) {
            count++;
            idx += sub.length();
        }
        return count;
    }
}
