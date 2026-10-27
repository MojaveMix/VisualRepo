package com.visualrepo;

import com.visualrepo.dto.ApiDtos.*;
import com.visualrepo.model.RetrievalMode;
import com.visualrepo.service.RepositoryAnalysisService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class VisualRepoIntegrationTest {

    @Autowired
    private RepositoryAnalysisService analysisService;

    @Test
    void endToEndIndexingGraphEmbeddingsAndCitedAiFlow() {
        // 1. Index demo multi-language repository (Stage 1: Basic Code Indexing)
        RepositorySummaryDto indexed = analysisService.indexRepository(
                new IndexRepoRequest("demo/order-payment-platform", "main", false)
        );
        assertThat(indexed.id()).isNotNull();
        assertThat(indexed.fileCount()).isGreaterThanOrEqualTo(9);
        assertThat(indexed.chunkCount()).isGreaterThan(10);
        assertThat(indexed.edgeCount()).isGreaterThanOrEqualTo(5);
        assertThat(indexed.embeddingsGenerated()).isFalse();

        // 2. Verify React Flow Architecture Graph nodes and edges
        ArchitectureGraphDto graph = analysisService.getArchitectureGraph(indexed.id());
        assertThat(graph.nodes()).hasSize(indexed.fileCount());
        assertThat(graph.edges()).isNotEmpty();
        assertThat(graph.edges())
                .anyMatch(e -> "API_CALL".equals(e.relationType())
                        && e.source().endsWith("checkoutApi.ts")
                        && e.target().endsWith("OrderController.java"));

        // 3. Inspect a specific file and its extracted symbols & line numbers
        SourceFileDetailDto controllerFile = analysisService.getSourceFileDetail(
                indexed.id(),
                "backend/src/main/java/com/acme/orders/controller/OrderController.java"
        );
        assertThat(controllerFile.language()).isEqualTo("Java");
        assertThat(controllerFile.architecturalRole()).isEqualTo("CONTROLLER");
        assertThat(controllerFile.symbols()).extracting(SymbolInfoDto::name)
                .contains("OrderController", "submitCheckout()", "listCustomerOrders()");

        // 4. Ask a question using Stage 1 Basic Code Indexing (before vector embeddings)
        CitedAnswerResponseDto basicAnswer = analysisService.askQuestion(
                indexed.id(),
                new AskQuestionRequest(
                        "How does submitCheckout validate fraud risk before capturing an order?",
                        "BASIC_INDEX",
                        null
                )
        );
        assertThat(basicAnswer.retrievalMode()).isEqualTo(RetrievalMode.BASIC_INDEX);
        assertThat(basicAnswer.answer()).isNotBlank();
        assertThat(basicAnswer.citations()).isNotEmpty();
        CitationDto firstCitation = basicAnswer.citations().get(0);
        assertThat(firstCitation.filePath()).isNotBlank();
        assertThat(firstCitation.startLine()).isGreaterThanOrEqualTo(1);
        assertThat(firstCitation.endLine()).isGreaterThanOrEqualTo(firstCitation.startLine());
        assertThat(firstCitation.snippet()).isNotBlank();

        // 5. Upgrade to Stage 2: Generate Embeddings + Vector Search
        RepositorySummaryDto withEmbeddings = analysisService.generateEmbeddings(indexed.id());
        assertThat(withEmbeddings.embeddingsGenerated()).isTrue();
        assertThat(withEmbeddings.embeddingModel()).isNotBlank();

        // 6. Ask a question using Stage 2 Vector Hybrid Retrieval
        CitedAnswerResponseDto vectorAnswer = analysisService.askQuestion(
                indexed.id(),
                new AskQuestionRequest(
                        "Where are the payment retry limits and single transaction thresholds configured?",
                        "VECTOR_HYBRID",
                        null
                )
        );
        assertThat(vectorAnswer.retrievalMode()).isEqualTo(RetrievalMode.VECTOR_HYBRID);
        assertThat(vectorAnswer.citations()).isNotEmpty();

        // 7. Verify Analysis History persisted in database
        List<CitedAnswerResponseDto> history = analysisService.listAnalysisHistory(indexed.id());
        assertThat(history).hasSizeGreaterThanOrEqualTo(2);
    }
}
