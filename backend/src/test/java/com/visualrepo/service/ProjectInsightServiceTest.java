package com.visualrepo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualrepo.dto.ApiDtos.*;
import com.visualrepo.model.DependencyEdgeEntity;
import com.visualrepo.model.RepositoryEntity;
import com.visualrepo.model.SourceFileEntity;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ProjectInsightServiceTest {

    private ProjectInsightService buildService() {
        ObjectMapper mapper = new ObjectMapper();
        OllamaStructuredAiService aiService = new OllamaStructuredAiService(RestClient.builder(), mapper);
        return new ProjectInsightService(null, null, null, null, aiService, mapper);
    }

    @Test
    void prunesFalseSubstringEdgesDetectsCyclesViolationsAndInfersErRelations() {
        ProjectInsightService service = buildService();

        RepositoryEntity repo = new RepositoryEntity();
        repo.setId(42L);
        repo.setOwner("acme");
        repo.setName("commerce");

        SourceFileEntity controller = file(
                "src/main/java/com/acme/OrderController.java",
                "Java",
                "MODULE",
                "@RestController\npublic class OrderController {\n  private final OrderService orderService;\n}"
        );
        SourceFileEntity serviceFile = file(
                "src/main/java/com/acme/OrderService.java",
                "Java",
                "MODULE",
                "@Service\n@Transactional\npublic class OrderService {\n  private final OrderRepository orderRepository;\n}"
        );
        SourceFileEntity repoFile = file(
                "src/main/java/com/acme/OrderRepository.java",
                "Java",
                "MODULE",
                "@Repository\npublic interface OrderRepository extends JpaRepository<Order, Long> {\n  // cycle back to OrderService\n  OrderService helper();\n}"
        );
        SourceFileEntity entityFile = file(
                "src/main/java/com/acme/Order.java",
                "Java",
                "MODULE",
                "@Entity\n@Table(name = \"orders\")\npublic class Order { Long id; Long customerId; }"
        );

        // Include a false-positive substring edge: OrderController -> Order (because "OrderController" contains substring "Order")
        DependencyEdgeEntity valid1 = edge(controller.getPath(), serviceFile.getPath(), "INJECTION", "OrderService");
        DependencyEdgeEntity valid2 = edge(serviceFile.getPath(), repoFile.getPath(), "INJECTION", "OrderRepository");
        DependencyEdgeEntity cycleEdge = edge(repoFile.getPath(), serviceFile.getPath(), "IMPORT", "OrderService");
        DependencyEdgeEntity falsePositive = edge(controller.getPath(), entityFile.getPath(), "INJECTION", "Order");

        // ER entities without explicit @ManyToOne, plus an associative join table
        ErEntityDto customers = new ErEntityDto(
                "Customer",
                "Customer",
                "customers",
                "src/main/java/com/acme/Customer.java",
                1,
                20,
                List.of(
                        new ErColumnDto("id", "id", "Long", "BIGINT", true, false, false, true, null, "Customer.java", 5),
                        new ErColumnDto("email", "email", "String", "VARCHAR(255)", false, false, false, true, null, "Customer.java", 8)
                )
        );
        ErEntityDto orders = new ErEntityDto(
                "Order",
                "Order",
                "orders",
                entityFile.getPath(),
                1,
                25,
                List.of(
                        new ErColumnDto("id", "id", "Long", "BIGINT", true, false, false, true, null, entityFile.getPath(), 5),
                        new ErColumnDto("customer_id", "customerId", "Long", "BIGINT", false, false, false, false, null, entityFile.getPath(), 9)
                )
        );
        ErEntityDto products = new ErEntityDto(
                "Product",
                "Product",
                "products",
                "src/main/java/com/acme/Product.java",
                1,
                20,
                List.of(
                        new ErColumnDto("id", "id", "Long", "BIGINT", true, false, false, true, null, "Product.java", 5)
                )
        );
        ErEntityDto orderProducts = new ErEntityDto(
                "OrderProduct",
                "OrderProduct",
                "order_products",
                "src/main/java/com/acme/OrderProduct.java",
                1,
                20,
                List.of(
                        new ErColumnDto("order_id", "orderId", "Long", "BIGINT", false, false, false, false, null, "OrderProduct.java", 6),
                        new ErColumnDto("product_id", "productId", "Long", "BIGINT", false, false, false, false, null, "OrderProduct.java", 9)
                )
        );

        ErDiagramDto erDiagram = new ErDiagramDto(
                42L,
                "acme/commerce",
                List.of(customers, orders, products, orderProducts),
                List.of()
        );

        ProjectInsightsDto insights = service.computeInsights(
                repo,
                List.of(controller, serviceFile, repoFile, entityFile),
                List.of(valid1, valid2, cycleEdge, falsePositive),
                erDiagram,
                "algorithm",
                null
        );

        assertThat(insights.engine()).isEqualTo("algorithm");
        // 1. False positive edge OrderController -> Order is pruned
        assertThat(insights.prunedEdges())
                .hasSize(1)
                .first()
                .satisfies(p -> {
                    assertThat(p.source()).isEqualTo(controller.getPath());
                    assertThat(p.target()).isEqualTo(entityFile.getPath());
                });

        // 2. Roles are accurately classified from AST annotations
        assertThat(insights.files())
                .filteredOn(f -> f.path().equals(controller.getPath()))
                .first()
                .satisfies(f -> assertThat(f.role()).isEqualTo("CONTROLLER"));
        assertThat(insights.files())
                .filteredOn(f -> f.path().equals(serviceFile.getPath()))
                .first()
                .satisfies(f -> assertThat(f.role()).isEqualTo("SERVICE"));
        assertThat(insights.files())
                .filteredOn(f -> f.path().equals(repoFile.getPath()))
                .first()
                .satisfies(f -> assertThat(f.role()).isEqualTo("REPOSITORY"));
        assertThat(insights.files())
                .filteredOn(f -> f.path().equals(entityFile.getPath()))
                .first()
                .satisfies(f -> assertThat(f.role()).isEqualTo("MODEL"));

        // 3. Cycle between OrderService and OrderRepository is detected
        assertThat(insights.cycles()).hasSize(1);
        assertThat(insights.cycles().get(0).files())
                .containsExactlyInAnyOrder(serviceFile.getPath(), repoFile.getPath());

        // 4. Upward layer violation REPOSITORY -> SERVICE is flagged
        assertThat(insights.violations())
                .anyMatch(v -> v.source().equals(repoFile.getPath())
                        && v.target().equals(serviceFile.getPath())
                        && "REPOSITORY".equals(v.sourceRole())
                        && "SERVICE".equals(v.targetRole()));

        // 5. ER inference finds Order -> Customer (MANY_TO_ONE via customer_id) and Order <-> Product (MANY_TO_MANY via order_products)
        assertThat(insights.inferredRelations())
                .anyMatch(r -> "Order".equals(r.source()) && "Customer".equals(r.target()) && "MANY_TO_ONE".equals(r.type()));
        assertThat(insights.inferredRelations())
                .anyMatch(r -> "MANY_TO_MANY".equals(r.type()) && "order_products".equals(r.joinTable()));
    }

    private SourceFileEntity file(String path, String language, String origRole, String content) {
        SourceFileEntity sf = new SourceFileEntity();
        sf.setPath(path);
        sf.setLanguage(language);
        sf.setArchitecturalRole(origRole);
        sf.setContent(content);
        sf.setLineCount(content.split("\n").length);
        sf.setSizeBytes(content.length());
        sf.setSymbolsJson("[]");
        sf.setImportsJson("[]");
        return sf;
    }

    private DependencyEdgeEntity edge(String src, String tgt, String type, String sym) {
        DependencyEdgeEntity e = new DependencyEdgeEntity();
        e.setSourceFilePath(src);
        e.setTargetFilePath(tgt);
        e.setRelationType(type);
        e.setTargetSymbol(sym);
        return e;
    }
}
