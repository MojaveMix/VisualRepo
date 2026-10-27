package com.visualrepo.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class EmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingService.class);
    private static final int FALLBACK_DIM = 256;

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    @Value("${visualrepo.ollama.base-url:http://localhost:11434}")
    private String ollamaBaseUrl;

    @Value("${visualrepo.ollama.embed-model:nomic-embed-text}")
    private String embedModel;

    public EmbeddingService(RestClient.Builder restClientBuilder, ObjectMapper objectMapper) {
        this.restClient = restClientBuilder.build();
        this.objectMapper = objectMapper;
    }

    public record EmbeddingResult(float[] vector, String modelUsed) {}

    public EmbeddingResult embedText(String text) {
        String truncated = text != null && text.length() > 3500 ? text.substring(0, 3500) : (text == null ? "" : text);
        try {
            Map<String, Object> payload = Map.of(
                    "model", embedModel,
                    "input", truncated
            );
            String responseStr = restClient.post()
                    .uri(URI.create(ollamaBaseUrl + "/api/embed"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .body(String.class);

            JsonNode root = objectMapper.readTree(responseStr);
            JsonNode embeddingsNode = root.path("embeddings");
            if (embeddingsNode.isArray() && !embeddingsNode.isEmpty() && embeddingsNode.get(0).isArray()) {
                JsonNode firstVec = embeddingsNode.get(0);
                float[] vec = new float[firstVec.size()];
                for (int i = 0; i < firstVec.size(); i++) {
                    vec[i] = (float) firstVec.get(i).asDouble();
                }
                return new EmbeddingResult(vec, embedModel);
            }
        } catch (Exception e) {
            log.debug("Ollama /api/embed unavailable ({}), using deterministic local vector embedding fallback", e.getMessage());
        }

        return new EmbeddingResult(computeDeterministicCodeVector(truncated), "local-code-vectorizer-256d");
    }

    public String serializeVector(float[] vector) {
        try {
            return objectMapper.writeValueAsString(vector);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize embedding vector", e);
        }
    }

    public float[] deserializeVector(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            List<Float> list = objectMapper.readValue(json, new TypeReference<List<Float>>() {});
            float[] vec = new float[list.size()];
            for (int i = 0; i < list.size(); i++) {
                vec[i] = list.get(i);
            }
            return vec;
        } catch (Exception e) {
            return null;
        }
    }

    public double cosineSimilarity(float[] a, float[] b) {
        if (a == null || b == null || a.length == 0 || a.length != b.length) {
            return 0.0;
        }
        double dot = 0.0;
        double normA = 0.0;
        double normB = 0.0;
        for (int i = 0; i < a.length; i++) {
            dot += (double) a[i] * b[i];
            normA += (double) a[i] * a[i];
            normB += (double) b[i] * b[i];
        }
        if (normA == 0.0 || normB == 0.0) {
            return 0.0;
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private float[] computeDeterministicCodeVector(String text) {
        float[] vec = new float[FALLBACK_DIM];
        String[] tokens = text.toLowerCase(Locale.ROOT).split("[^a-z0-9_]+");
        for (String token : tokens) {
            if (token.length() < 2) {
                continue;
            }
            int hash = Math.abs(token.hashCode());
            int idx = hash % FALLBACK_DIM;
            float sign = ((hash / FALLBACK_DIM) % 2 == 0) ? 1.0f : -1.0f;
            vec[idx] += sign * (1.0f + Math.min(token.length(), 12) * 0.1f);
        }
        double norm = 0.0;
        for (float v : vec) {
            norm += (double) v * v;
        }
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (int i = 0; i < vec.length; i++) {
                vec[i] = (float) (vec[i] / norm);
            }
        }
        return vec;
    }
}
