package com.visualrepo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class GitHubClientService {

    private static final Logger log = LoggerFactory.getLogger(GitHubClientService.class);
    private static final int MAX_FILES_TO_INDEX = 85;
    private static final long MAX_FILE_SIZE_BYTES = 180_000;

    private static final Set<String> IGNORED_SEGMENTS = Set.of(
            "node_modules/", "dist/", "build/", "target/", ".git/", ".idea/", ".vscode/",
            "vendor/", ".next/", "coverage/", "__pycache__/", ".gradle/", ".mvn/"
    );

    private static final Set<String> IGNORED_FILENAMES = Set.of(
            "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "poetry.lock"
    );

    private static final List<String> PRIORITY_EXTENSIONS = List.of(
            ".java", ".ts", ".tsx", ".py", ".go", ".rs", ".js", ".jsx", ".kt", ".cs",
            ".sql", ".prisma", ".graphql", ".yml", ".yaml", ".xml", ".json", ".md"
    );

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    @Value("${visualrepo.github.base-url:https://api.github.com}")
    private String githubApiBaseUrl;

    @Value("${visualrepo.github.token:}")
    private String githubToken;

    public GitHubClientService(RestClient.Builder restClientBuilder, ObjectMapper objectMapper) {
        this.restClient = restClientBuilder.build();
        this.objectMapper = objectMapper;
    }

    public boolean isTokenConfigured() {
        return githubToken != null && !githubToken.isBlank();
    }

    public record RepoCoordinates(String owner, String name, String branchOverride) {}

    public record FetchedFile(String path, String sha, long sizeBytes, String content) {}

    public record FetchedRepository(
            String owner,
            String name,
            String defaultBranch,
            String commitSha,
            String htmlUrl,
            String description,
            List<FetchedFile> files
    ) {}

    public RepoCoordinates parseCoordinates(String input, String branchOverride) {
        String trimmed = input == null ? "" : input.trim();
        if (trimmed.endsWith(".git")) {
            trimmed = trimmed.substring(0, trimmed.length() - 4);
        }
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            URI uri = URI.create(trimmed);
            String[] parts = Arrays.stream(uri.getPath().split("/"))
                    .filter(s -> !s.isBlank())
                    .toArray(String[]::new);
            if (parts.length >= 2) {
                String owner = parts[0];
                String repo = parts[1];
                String detectedBranch = branchOverride;
                if ((detectedBranch == null || detectedBranch.isBlank()) && parts.length >= 4 && "tree".equals(parts[2])) {
                    detectedBranch = parts[3];
                }
                return new RepoCoordinates(owner, repo, detectedBranch);
            }
        }
        String[] slashParts = trimmed.split("/");
        if (slashParts.length >= 2) {
            return new RepoCoordinates(slashParts[0].trim(), slashParts[1].trim(), branchOverride);
        }
        throw new IllegalArgumentException("Invalid repository format. Use 'owner/repo' or 'https://github.com/owner/repo'.");
    }

    public FetchedRepository fetchRepository(String repoUrlOrFullName, String branchOverride) {
        RepoCoordinates coords = parseCoordinates(repoUrlOrFullName, branchOverride);
        if ("demo".equalsIgnoreCase(coords.owner()) && "order-payment-platform".equalsIgnoreCase(coords.name())) {
            return buildBuiltInDemoRepository();
        }

        try {
            // 1. Fetch repository metadata via GitHub REST API
            String repoMetaUrl = githubApiBaseUrl + "/repos/" + coords.owner() + "/" + coords.name();
            String repoJsonStr = executeGitHubGet(repoMetaUrl);
            JsonNode repoNode = objectMapper.readTree(repoJsonStr);

            String defaultBranch = (coords.branchOverride() != null && !coords.branchOverride().isBlank())
                    ? coords.branchOverride().trim()
                    : repoNode.path("default_branch").asText("main");
            String description = repoNode.path("description").isNull() ? "" : repoNode.path("description").asText("");
            String htmlUrl = repoNode.path("html_url").asText("https://github.com/" + coords.owner() + "/" + coords.name());

            // 2. Fetch recursive Git tree via GitHub REST API
            String treeUrl = githubApiBaseUrl + "/repos/" + coords.owner() + "/" + coords.name()
                    + "/git/trees/" + defaultBranch + "?recursive=1";
            String treeJsonStr = executeGitHubGet(treeUrl);
            JsonNode treeRoot = objectMapper.readTree(treeJsonStr);
            String commitSha = treeRoot.path("sha").asText("");
            JsonNode treeArray = treeRoot.path("tree");

            List<JsonNode> candidateNodes = new ArrayList<>();
            if (treeArray.isArray()) {
                for (JsonNode item : treeArray) {
                    if (!"blob".equals(item.path("type").asText())) {
                        continue;
                    }
                    String path = item.path("path").asText("");
                    long size = item.path("size").asLong(0);
                    if (isIndexableSourceFile(path, size)) {
                        candidateNodes.add(item);
                    }
                }
            }

            candidateNodes.sort(Comparator.comparingInt(a -> extensionPriority(a.path("path").asText(""))));
            if (candidateNodes.size() > MAX_FILES_TO_INDEX) {
                candidateNodes = candidateNodes.subList(0, MAX_FILES_TO_INDEX);
            }

            // 3. Fetch file contents (preferring raw.githubusercontent.com to preserve REST rate limits, with Blob API fallback)
            List<FetchedFile> fetchedFiles = new ArrayList<>();
            for (JsonNode node : candidateNodes) {
                String path = node.path("path").asText();
                String sha = node.path("sha").asText("");
                long size = node.path("size").asLong(0);
                try {
                    String content = fetchFileContent(coords.owner(), coords.name(), defaultBranch, path, sha);
                    if (content != null && !content.isBlank() && !isBinaryContent(content)) {
                        fetchedFiles.add(new FetchedFile(path, sha, size, normalizeNewlines(content)));
                    }
                } catch (Exception ex) {
                    log.debug("Skipping file {} due to fetch error: {}", path, ex.getMessage());
                }
            }

            return new FetchedRepository(
                    coords.owner(),
                    coords.name(),
                    defaultBranch,
                    commitSha,
                    htmlUrl,
                    description,
                    fetchedFiles
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to fetch repository '" + coords.owner() + "/" + coords.name()
                    + "' from GitHub REST API: " + e.getMessage(), e);
        }
    }

    private String fetchFileContent(String owner, String repo, String branch, String path, String blobSha) {
        String rawUrl = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + branch + "/" + path;
        try {
            RestClient.RequestHeadersSpec<?> req = restClient.get()
                    .uri(URI.create(rawUrl.replace(" ", "%20")))
                    .header(HttpHeaders.USER_AGENT, "VisualRepo-Analyzer/1.0");
            if (isTokenConfigured()) {
                req = req.header(HttpHeaders.AUTHORIZATION, "Bearer " + githubToken.trim());
            }
            return req.retrieve().body(String.class);
        } catch (Exception rawEx) {
            if (blobSha != null && !blobSha.isBlank()) {
                try {
                    String blobUrl = githubApiBaseUrl + "/repos/" + owner + "/" + repo + "/git/blobs/" + blobSha;
                    String blobJson = executeGitHubGet(blobUrl);
                    JsonNode blobNode = objectMapper.readTree(blobJson);
                    String encoded = blobNode.path("content").asText("").replaceAll("\\s+", "");
                    byte[] decoded = Base64.getDecoder().decode(encoded);
                    return new String(decoded, StandardCharsets.UTF_8);
                } catch (Exception blobEx) {
                    log.debug("Blob fallback failed for {}: {}", path, blobEx.getMessage());
                }
            }
            throw rawEx;
        }
    }

    private String executeGitHubGet(String url) {
        RestClient.RequestHeadersSpec<?> spec = restClient.get()
                .uri(URI.create(url))
                .header(HttpHeaders.ACCEPT, "application/vnd.github+json")
                .header(HttpHeaders.USER_AGENT, "VisualRepo-Analyzer/1.0")
                .header("X-GitHub-Api-Version", "2022-11-28");
        if (isTokenConfigured()) {
            spec = spec.header(HttpHeaders.AUTHORIZATION, "Bearer " + githubToken.trim());
        }
        return spec.retrieve().body(String.class);
    }

    private boolean isIndexableSourceFile(String path, long size) {
        if (path == null || path.isBlank() || size <= 0 || size > MAX_FILE_SIZE_BYTES) {
            return false;
        }
        String lower = path.toLowerCase(Locale.ROOT);
        for (String ignored : IGNORED_SEGMENTS) {
            if (lower.startsWith(ignored) || lower.contains("/" + ignored)) {
                return false;
            }
        }
        String fileName = lower.contains("/") ? lower.substring(lower.lastIndexOf('/') + 1) : lower;
        if (IGNORED_FILENAMES.contains(fileName) || fileName.endsWith(".min.js") || fileName.endsWith(".min.css") || fileName.endsWith(".d.ts")) {
            return false;
        }
        for (String ext : PRIORITY_EXTENSIONS) {
            if (lower.endsWith(ext)) {
                return true;
            }
        }
        return false;
    }

    private int extensionPriority(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        for (int i = 0; i < PRIORITY_EXTENSIONS.size(); i++) {
            if (lower.endsWith(PRIORITY_EXTENSIONS.get(i))) {
                return i;
            }
        }
        return PRIORITY_EXTENSIONS.size();
    }

    private boolean isBinaryContent(String content) {
        int checkLen = Math.min(content.length(), 1024);
        for (int i = 0; i < checkLen; i++) {
            if (content.charAt(i) == '\0') {
                return true;
            }
        }
        return false;
    }

    private String normalizeNewlines(String text) {
        return text.replace("\r\n", "\n").replace("\r", "\n");
    }

    private FetchedRepository buildBuiltInDemoRepository() {
        List<FetchedFile> files = new ArrayList<>();

        String orderController = """
                package com.acme.orders.controller;

                import com.acme.orders.model.OrderRecord;
                import com.acme.orders.service.OrderOrchestratorService;
                import com.acme.orders.service.FraudDetectionClient;
                import org.springframework.http.ResponseEntity;
                import org.springframework.web.bind.annotation.*;

                import java.math.BigDecimal;
                import java.util.List;

                @RestController
                @RequestMapping("/api/v1/orders")
                public class OrderController {

                    private final OrderOrchestratorService orchestratorService;
                    private final FraudDetectionClient fraudDetectionClient;

                    public OrderController(OrderOrchestratorService orchestratorService,
                                           FraudDetectionClient fraudDetectionClient) {
                        this.orchestratorService = orchestratorService;
                        this.fraudDetectionClient = fraudDetectionClient;
                    }

                    @PostMapping("/checkout")
                    public ResponseEntity<OrderRecord> submitCheckout(@RequestParam String customerId,
                                                                      @RequestParam BigDecimal totalAmount) {
                        boolean highRisk = fraudDetectionClient.evaluateRiskScore(customerId, totalAmount);
                        if (highRisk) {
                            throw new IllegalStateException("Checkout blocked by fraud risk policy for customer: " + customerId);
                        }
                        OrderRecord created = orchestratorService.placeAndCaptureOrder(customerId, totalAmount);
                        return ResponseEntity.ok(created);
                    }

                    @GetMapping("/customer/{customerId}")
                    public List<OrderRecord> listCustomerOrders(@PathVariable String customerId) {
                        return orchestratorService.findOrdersForCustomer(customerId);
                    }
                }
                """;

        String orchestratorService = """
                package com.acme.orders.service;

                import com.acme.orders.model.OrderRecord;
                import com.acme.orders.repository.OrderLedgerRepository;
                import org.springframework.stereotype.Service;
                import org.springframework.transaction.annotation.Transactional;

                import java.math.BigDecimal;
                import java.time.Instant;
                import java.util.List;
                import java.util.UUID;

                @Service
                public class OrderOrchestratorService {

                    private final OrderLedgerRepository ledgerRepository;
                    private final PaymentGatewayService paymentGatewayService;

                    public OrderOrchestratorService(OrderLedgerRepository ledgerRepository,
                                                    PaymentGatewayService paymentGatewayService) {
                        this.ledgerRepository = ledgerRepository;
                        this.paymentGatewayService = paymentGatewayService;
                    }

                    @Transactional
                    public OrderRecord placeAndCaptureOrder(String customerId, BigDecimal amount) {
                        String paymentRef = paymentGatewayService.authorizeAndCapture(customerId, amount);
                        OrderRecord order = new OrderRecord(
                                UUID.randomUUID().toString(),
                                customerId,
                                amount,
                                "CAPTURED",
                                paymentRef,
                                Instant.now()
                        );
                        return ledgerRepository.save(order);
                    }

                    @Transactional(readOnly = true)
                    public List<OrderRecord> findOrdersForCustomer(String customerId) {
                        return ledgerRepository.findByCustomerIdOrderByCreatedAtDesc(customerId);
                    }
                }
                """;

        String paymentGatewayService = """
                package com.acme.orders.service;

                import com.acme.orders.config.PaymentRetryConfig;
                import org.springframework.stereotype.Service;

                import java.math.BigDecimal;

                @Service
                public class PaymentGatewayService {

                    private final PaymentRetryConfig retryConfig;

                    public PaymentGatewayService(PaymentRetryConfig retryConfig) {
                        this.retryConfig = retryConfig;
                    }

                    public String authorizeAndCapture(String customerId, BigDecimal amount) {
                        if (amount.compareTo(retryConfig.getMaxSingleTransactionLimit()) > 0) {
                            throw new IllegalArgumentException("Amount exceeds configured single-transaction limit");
                        }
                        int attempts = 0;
                        while (attempts < retryConfig.getMaxRetries()) {
                            attempts++;
                            if (amount.signum() > 0) {
                                return "PAY-" + customerId.toUpperCase() + "-" + System.currentTimeMillis();
                            }
                        }
                        throw new IllegalStateException("Payment capture failed after retries");
                    }
                }
                """;

        String fraudDetectionClient = """
                package com.acme.orders.service;

                import com.acme.orders.config.PaymentRetryConfig;
                import org.springframework.stereotype.Component;

                import java.math.BigDecimal;

                @Component
                public class FraudDetectionClient {

                    private final PaymentRetryConfig config;

                    public FraudDetectionClient(PaymentRetryConfig config) {
                        this.config = config;
                    }

                    public boolean evaluateRiskScore(String customerId, BigDecimal totalAmount) {
                        if (customerId == null || customerId.startsWith("suspicious-")) {
                            return true;
                        }
                        return totalAmount.compareTo(config.getFraudFlagThreshold()) >= 0;
                    }
                }
                """;

        String orderLedgerRepository = """
                package com.acme.orders.repository;

                import com.acme.orders.model.OrderRecord;
                import org.springframework.data.jpa.repository.JpaRepository;
                import org.springframework.stereotype.Repository;

                import java.util.List;

                @Repository
                public interface OrderLedgerRepository extends JpaRepository<OrderRecord, String> {
                    List<OrderRecord> findByCustomerIdOrderByCreatedAtDesc(String customerId);
                }
                """;

        String orderRecordModel = """
                package com.acme.orders.model;

                import jakarta.persistence.Entity;
                import jakarta.persistence.Id;
                import jakarta.persistence.Table;

                import java.math.BigDecimal;
                import java.time.Instant;

                @Entity
                @Table(name = "order_ledger")
                public class OrderRecord {

                    @Id
                    private String id;
                    private String customerId;
                    private BigDecimal amount;
                    private String status;
                    private String paymentReference;
                    private Instant createdAt;

                    public OrderRecord() {}

                    public OrderRecord(String id, String customerId, BigDecimal amount,
                                       String status, String paymentReference, Instant createdAt) {
                        this.id = id;
                        this.customerId = customerId;
                        this.amount = amount;
                        this.status = status;
                        this.paymentReference = paymentReference;
                        this.createdAt = createdAt;
                    }

                    public String getId() { return id; }
                    public String getCustomerId() { return customerId; }
                    public BigDecimal getAmount() { return amount; }
                    public String getStatus() { return status; }
                    public String getPaymentReference() { return paymentReference; }
                    public Instant getCreatedAt() { return createdAt; }
                }
                """;

        String orderItemModel = """
                package com.acme.orders.model;

                import jakarta.persistence.Entity;
                import jakarta.persistence.Id;
                import jakarta.persistence.JoinColumn;
                import jakarta.persistence.ManyToOne;
                import jakarta.persistence.Table;

                import java.math.BigDecimal;

                @Entity
                @Table(name = "order_items")
                public class OrderItem {

                    @Id
                    private String id;

                    @ManyToOne(optional = false)
                    @JoinColumn(name = "order_id")
                    private OrderRecord order;

                    private String sku;
                    private int quantity;
                    private BigDecimal unitPrice;

                    public String getId() { return id; }
                    public OrderRecord getOrder() { return order; }
                    public String getSku() { return sku; }
                    public int getQuantity() { return quantity; }
                    public BigDecimal getUnitPrice() { return unitPrice; }
                }
                """;

        String paymentRetryConfig = """
                package com.acme.orders.config;

                import org.springframework.context.annotation.Configuration;
                import java.math.BigDecimal;

                @Configuration
                public class PaymentRetryConfig {

                    private final int maxRetries = 3;
                    private final BigDecimal maxSingleTransactionLimit = new BigDecimal("25000.00");
                    private final BigDecimal fraudFlagThreshold = new BigDecimal("10000.00");

                    public int getMaxRetries() {
                        return maxRetries;
                    }

                    public BigDecimal getMaxSingleTransactionLimit() {
                        return maxSingleTransactionLimit;
                    }

                    public BigDecimal getFraudFlagThreshold() {
                        return fraudFlagThreshold;
                    }
                }
                """;

        String checkoutApiTs = """
                export interface CheckoutPayload {
                  customerId: string;
                  totalAmount: number;
                }

                export interface OrderResponse {
                  id: string;
                  customerId: string;
                  amount: number;
                  status: string;
                  paymentReference: string;
                  createdAt: string;
                }

                export async function postCheckoutOrder(payload: CheckoutPayload): Promise<OrderResponse> {
                  const params = new URLSearchParams({
                    customerId: payload.customerId,
                    totalAmount: payload.totalAmount.toString(),
                  });
                  const response = await fetch(`/api/v1/orders/checkout?${params.toString()}`, {
                    method: 'POST',
                  });
                  if (!response.ok) {
                    throw new Error(`Checkout failed with status ${response.status}`);
                  }
                  return response.json();
                }
                """;

        String checkoutDashboardTsx = """
                import React, { useState } from 'react';
                import { postCheckoutOrder, OrderResponse } from '../api/checkoutApi';

                export function CheckoutDashboard() {
                  const [customerId, setCustomerId] = useState('cust-101');
                  const [amount, setAmount] = useState(450);
                  const [receipt, setReceipt] = useState<OrderResponse | null>(null);

                  async function handleCheckoutSubmit() {
                    const result = await postCheckoutOrder({
                      customerId,
                      totalAmount: amount,
                    });
                    setReceipt(result);
                  }

                  return (
                    <div className="p-6">
                      <h2>Enterprise Order Checkout</h2>
                      <button onClick={handleCheckoutSubmit}>Authorize & Capture</button>
                      {receipt && <p>Captured Payment Ref: {receipt.paymentReference}</p>}
                    </div>
                  );
                }
                """;

        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/controller/OrderController.java", "demo-sha-1", orderController.length(), orderController));
        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/service/OrderOrchestratorService.java", "demo-sha-2", orchestratorService.length(), orchestratorService));
        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/service/PaymentGatewayService.java", "demo-sha-3", paymentGatewayService.length(), paymentGatewayService));
        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/service/FraudDetectionClient.java", "demo-sha-4", fraudDetectionClient.length(), fraudDetectionClient));
        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/repository/OrderLedgerRepository.java", "demo-sha-5", orderLedgerRepository.length(), orderLedgerRepository));
        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/model/OrderRecord.java", "demo-sha-6", orderRecordModel.length(), orderRecordModel));
        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/model/OrderItem.java", "demo-sha-10", orderItemModel.length(), orderItemModel));
        files.add(new FetchedFile("backend/src/main/java/com/acme/orders/config/PaymentRetryConfig.java", "demo-sha-7", paymentRetryConfig.length(), paymentRetryConfig));
        files.add(new FetchedFile("frontend/src/api/checkoutApi.ts", "demo-sha-8", checkoutApiTs.length(), checkoutApiTs));
        files.add(new FetchedFile("frontend/src/components/CheckoutDashboard.tsx", "demo-sha-9", checkoutDashboardTsx.length(), checkoutDashboardTsx));

        return new FetchedRepository(
                "demo",
                "order-payment-platform",
                "main",
                "a1b2c3d4e5f60718293a",
                "https://github.com/demo/order-payment-platform",
                "Multi-tier Order & Payment Platform (Spring Boot 3 + React TypeScript) for testing line-range citations and React Flow architecture graphs.",
                files
        );
    }
}
