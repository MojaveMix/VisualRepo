package com.visualrepo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualrepo.dto.ApiDtos.CitationDto;
import com.visualrepo.model.CodeChunkEntity;
import com.visualrepo.model.RepositoryEntity;
import com.visualrepo.model.SourceFileEntity;
import com.visualrepo.service.CodeRetrievalService.ScoredChunk;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.util.*;

@Service
public class OllamaStructuredAiService {

    private static final Logger log = LoggerFactory.getLogger(OllamaStructuredAiService.class);

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    @Value("${visualrepo.ollama.base-url:http://localhost:11434}")
    private String ollamaBaseUrl;

    @Value("${visualrepo.ollama.chat-model:qwen2.5-coder:7b}")
    private String defaultChatModel;

    public OllamaStructuredAiService(RestClient.Builder restClientBuilder, ObjectMapper objectMapper) {
        this.restClient = restClientBuilder.build();
        this.objectMapper = objectMapper;
    }

    public record StructuredAiOutput(
            String answer,
            String architecturalSummary,
            List<CitationDto> verifiedCitations,
            String modelUsed
    ) {}

    public record OllamaStatus(boolean online, List<String> models, String defaultChatModel, String defaultEmbedModel) {}

    public List<String> listAvailableModels() {
        try {
            String resp = restClient.get()
                    .uri(URI.create(ollamaBaseUrl + "/api/tags"))
                    .retrieve()
                    .body(String.class);
            JsonNode root = objectMapper.readTree(resp);
            JsonNode modelsNode = root.path("models");
            List<String> names = new ArrayList<>();
            if (modelsNode.isArray()) {
                for (JsonNode m : modelsNode) {
                    String name = m.path("name").asText("");
                    if (!name.isBlank()) {
                        names.add(name);
                    }
                }
            }
            return names;
        } catch (Exception e) {
            return List.of();
        }
    }

    public StructuredAiOutput generateCitedAnswer(
            RepositoryEntity repo,
            String question,
            List<ScoredChunk> retrievedChunks,
            Map<String, SourceFileEntity> filesByPath,
            String modelOverride
    ) {
        String activeModel = (modelOverride != null && !modelOverride.isBlank())
                ? modelOverride.trim()
                : defaultChatModel;

        String numberedEvidenceContext = buildLineNumberedEvidenceContext(retrievedChunks);

        String systemPrompt = """
                You are VisualRepo AI, an evidence-based software architecture assistant.
                CRITICAL RULES:
                1. Answer the developer's question using ONLY the provided repository source code evidence.
                2. Every claim MUST be backed by exact citations (`filePath`, `startLine`, `endLine`, `symbolName`, `reason`).
                3. Use the exact `filePath` and 1-based line numbers shown on the left of each code line (e.g. `24: ...`).
                4. Never invent file paths or line ranges outside the provided evidence blocks.
                5. In `answer`, reference files and line ranges clearly (e.g., `OrderController.java (L25-L34)`) and explain the control flow and architectural responsibilities.
                """;

        String userPrompt = "Repository: " + repo.getOwner() + "/" + repo.getName() + " (branch: " + repo.getDefaultBranch() + ")\n"
                + "Developer Question: " + question + "\n\n"
                + "=== INDEXED SOURCE CODE EVIDENCE (WITH EXACT 1-BASED LINE NUMBERS) ===\n"
                + numberedEvidenceContext;

        Map<String, Object> jsonSchema = buildStructuredOutputJsonSchema();

        try {
            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("model", activeModel);
            requestBody.put("stream", false);
            requestBody.put("format", jsonSchema);
            requestBody.put("options", Map.of("temperature", 0.1));
            requestBody.put("messages", List.of(
                    Map.of("role", "system", "content", systemPrompt),
                    Map.of("role", "user", "content", userPrompt)
            ));

            String rawResponse = restClient.post()
                    .uri(URI.create(ollamaBaseUrl + "/api/chat"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(String.class);

            JsonNode chatRoot = objectMapper.readTree(rawResponse);
            String contentJson = chatRoot.path("message").path("content").asText("");
            contentJson = stripThinkingTagsIfAny(contentJson);

            JsonNode structured = objectMapper.readTree(contentJson);
            String answer = structured.path("answer").asText("");
            String archSummary = structured.path("architecturalSummary").asText("");
            JsonNode rawCitations = structured.path("citations");

            List<CitationDto> verifiedCitations = verifyAndEnrichCitations(
                    repo, rawCitations, retrievedChunks, filesByPath
            );

            if (!answer.isBlank()) {
                return new StructuredAiOutput(
                        answer,
                        archSummary.isBlank() ? "Structured analysis generated via Ollama (" + activeModel + ")." : archSummary,
                        verifiedCitations,
                        activeModel
                );
            }
        } catch (Exception e) {
            log.warn("Ollama structured chat call failed for model {}: {}. Using deterministic evidence synthesizer.",
                    activeModel, e.getMessage());
        }

        return buildDeterministicEvidenceFallback(repo, question, retrievedChunks, filesByPath);
    }

    private String buildLineNumberedEvidenceContext(List<ScoredChunk> chunks) {
        StringBuilder sb = new StringBuilder();
        int idx = 1;
        for (ScoredChunk sc : chunks) {
            CodeChunkEntity chunk = sc.chunk();
            sb.append("--- EVIDENCE BLOCK #").append(idx++)
                    .append(" | filePath: ").append(chunk.getFilePath())
                    .append(" | startLine: ").append(chunk.getStartLine())
                    .append(" | endLine: ").append(chunk.getEndLine())
                    .append(" | symbolName: ").append(chunk.getSymbolName())
                    .append(" ---\n");

            String[] lines = chunk.getContent().split("\n", -1);
            for (int i = 0; i < lines.length; i++) {
                int lineNumber = chunk.getStartLine() + i;
                sb.append(lineNumber).append(": ").append(lines[i]).append("\n");
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private Map<String, Object> buildStructuredOutputJsonSchema() {
        Map<String, Object> citationProps = Map.of(
                "filePath", Map.of("type", "string"),
                "startLine", Map.of("type", "integer"),
                "endLine", Map.of("type", "integer"),
                "symbolName", Map.of("type", "string"),
                "reason", Map.of("type", "string")
        );

        Map<String, Object> citationItemSchema = Map.of(
                "type", "object",
                "properties", citationProps,
                "required", List.of("filePath", "startLine", "endLine", "symbolName", "reason")
        );

        Map<String, Object> rootProps = Map.of(
                "answer", Map.of("type", "string"),
                "architecturalSummary", Map.of("type", "string"),
                "citations", Map.of(
                        "type", "array",
                        "items", citationItemSchema
                )
        );

        return Map.of(
                "type", "object",
                "properties", rootProps,
                "required", List.of("answer", "architecturalSummary", "citations")
        );
    }

    private List<CitationDto> verifyAndEnrichCitations(
            RepositoryEntity repo,
            JsonNode rawCitations,
            List<ScoredChunk> retrievedChunks,
            Map<String, SourceFileEntity> filesByPath
    ) {
        List<CitationDto> verified = new ArrayList<>();
        Set<String> seenKeys = new HashSet<>();

        if (rawCitations != null && rawCitations.isArray()) {
            for (JsonNode item : rawCitations) {
                String rawPath = item.path("filePath").asText("").trim();
                SourceFileEntity matchedFile = findMatchingSourceFile(rawPath, filesByPath);
                if (matchedFile == null) {
                    continue;
                }

                int start = Math.max(1, item.path("startLine").asInt(1));
                int end = Math.min(matchedFile.getLineCount(), Math.max(start, item.path("endLine").asInt(start)));
                String symbol = item.path("symbolName").asText(extractSimpleName(matchedFile.getPath()));
                String reason = item.path("reason").asText("Referenced in AI architectural analysis.");

                String key = matchedFile.getPath() + ":" + start + "-" + end;
                if (seenKeys.add(key)) {
                    String snippet = extractExactLineRange(matchedFile.getContent(), start, end);
                    String blobUrl = buildGitHubBlobUrl(repo, matchedFile.getPath(), start, end);
                    verified.add(new CitationDto(
                            matchedFile.getPath(),
                            start,
                            end,
                            symbol,
                            reason,
                            snippet,
                            blobUrl
                    ));
                }
            }
        }

        // Guarantee at least the top retrieved evidence chunks are attached if LLM omitted citations
        if (verified.isEmpty()) {
            for (int i = 0; i < Math.min(3, retrievedChunks.size()); i++) {
                CodeChunkEntity chunk = retrievedChunks.get(i).chunk();
                SourceFileEntity file = filesByPath.get(chunk.getFilePath());
                int start = chunk.getStartLine();
                int end = chunk.getEndLine();
                String snippet = file != null
                        ? extractExactLineRange(file.getContent(), start, end)
                        : chunk.getContent();
                verified.add(new CitationDto(
                        chunk.getFilePath(),
                        start,
                        end,
                        chunk.getSymbolName(),
                        "Primary indexed code block matching query symbols and semantics.",
                        snippet,
                        buildGitHubBlobUrl(repo, chunk.getFilePath(), start, end)
                ));
            }
        }

        return verified;
    }

    private StructuredAiOutput buildDeterministicEvidenceFallback(
            RepositoryEntity repo,
            String question,
            List<ScoredChunk> retrievedChunks,
            Map<String, SourceFileEntity> filesByPath
    ) {
        List<CitationDto> citations = new ArrayList<>();
        StringBuilder answerBuilder = new StringBuilder();
        answerBuilder.append("Based on the indexed source tree of **")
                .append(repo.getOwner()).append("/").append(repo.getName())
                .append("**, here are the exact source files and line ranges that address your question:\n\n");

        int count = Math.min(4, retrievedChunks.size());
        for (int i = 0; i < count; i++) {
            CodeChunkEntity chunk = retrievedChunks.get(i).chunk();
            SourceFileEntity sf = filesByPath.get(chunk.getFilePath());
            String role = sf != null ? sf.getArchitecturalRole() : chunk.getChunkType();
            int start = chunk.getStartLine();
            int end = chunk.getEndLine();
            String reason = "Defines " + chunk.getSymbolName() + " (" + role + ") in " + chunk.getFilePath()
                    + " at lines L" + start + "-L" + end + ".";

            answerBuilder.append(i + 1).append(". **`")
                    .append(chunk.getFilePath()).append("` (L").append(start).append("-L").append(end).append(")** — ")
                    .append("Symbol `").append(chunk.getSymbolName()).append("` (`").append(role).append("`). ")
                    .append("Inspect lines ").append(start).append(" to ").append(end)
                    .append(" in the Evidence Inspector to verify the exact implementation.\n");

            String snippet = sf != null ? extractExactLineRange(sf.getContent(), start, end) : chunk.getContent();
            citations.add(new CitationDto(
                    chunk.getFilePath(),
                    start,
                    end,
                    chunk.getSymbolName(),
                    reason,
                    snippet,
                    buildGitHubBlobUrl(repo, chunk.getFilePath(), start, end)
            ));
        }

        return new StructuredAiOutput(
                answerBuilder.toString(),
                "Synthesized directly from AST/language-rule code chunks with verified line ranges.",
                citations,
                "evidence-synthesizer (Ollama fallback)"
        );
    }

    private SourceFileEntity findMatchingSourceFile(String rawPath, Map<String, SourceFileEntity> filesByPath) {
        if (rawPath == null || rawPath.isBlank()) {
            return null;
        }
        if (filesByPath.containsKey(rawPath)) {
            return filesByPath.get(rawPath);
        }
        String normalized = rawPath.replace("\\", "/");
        if (filesByPath.containsKey(normalized)) {
            return filesByPath.get(normalized);
        }
        for (Map.Entry<String, SourceFileEntity> entry : filesByPath.entrySet()) {
            if (entry.getKey().endsWith(normalized) || normalized.endsWith(entry.getKey())) {
                return entry.getValue();
            }
        }
        return null;
    }

    private String extractExactLineRange(String content, int startLine, int endLine) {
        if (content == null || content.isEmpty()) {
            return "";
        }
        String[] lines = content.split("\n", -1);
        int s = Math.max(1, startLine);
        int e = Math.min(lines.length, Math.max(s, endLine));
        StringBuilder sb = new StringBuilder();
        for (int i = s - 1; i < e; i++) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(lines[i]);
        }
        return sb.toString();
    }

    private String buildGitHubBlobUrl(RepositoryEntity repo, String filePath, int startLine, int endLine) {
        return repo.getHtmlUrl() + "/blob/" + repo.getDefaultBranch() + "/" + filePath + "#L" + startLine + "-L" + endLine;
    }

    private String stripThinkingTagsIfAny(String text) {
        if (text == null) {
            return "";
        }
        String cleaned = text.replaceAll("(?s)<think>.*?</think>", "").trim();
        int firstBrace = cleaned.indexOf('{');
        int lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return cleaned.substring(firstBrace, lastBrace + 1);
        }
        return cleaned;
    }

    private String extractSimpleName(String path) {
        return path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
    }
}
