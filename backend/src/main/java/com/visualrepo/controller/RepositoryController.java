package com.visualrepo.controller;

import com.visualrepo.dto.ApiDtos.*;
import com.visualrepo.service.ErDiagramService;
import com.visualrepo.service.ProjectInsightService;
import com.visualrepo.service.RepositoryAnalysisService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class RepositoryController {

    private final RepositoryAnalysisService analysisService;
    private final ErDiagramService erDiagramService;
    private final ProjectInsightService projectInsightService;

    public RepositoryController(
            RepositoryAnalysisService analysisService,
            ErDiagramService erDiagramService,
            ProjectInsightService projectInsightService
    ) {
        this.analysisService = analysisService;
        this.erDiagramService = erDiagramService;
        this.projectInsightService = projectInsightService;
    }

    @GetMapping("/system/status")
    public SystemStatusDto getSystemStatus() {
        return analysisService.getSystemStatus();
    }

    @GetMapping("/repos")
    public List<RepositorySummaryDto> listRepositories() {
        return analysisService.listRepositories();
    }

    @PostMapping("/repos/index")
    public RepositorySummaryDto indexRepository(@Valid @RequestBody IndexRepoRequest request) {
        return analysisService.indexRepository(request);
    }

    @PostMapping("/repos/{id}/embeddings")
    public RepositorySummaryDto generateEmbeddings(@PathVariable Long id) {
        return analysisService.generateEmbeddings(id);
    }

    @GetMapping("/repos/{id}")
    public RepositorySummaryDto getRepository(@PathVariable Long id) {
        return analysisService.getRepository(id);
    }

    @DeleteMapping("/repos/{id}")
    public ResponseEntity<Void> deleteRepository(@PathVariable Long id) {
        analysisService.deleteRepository(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/repos/{id}/files")
    public List<SourceFileSummaryDto> listFiles(@PathVariable Long id) {
        return analysisService.listRepositoryFiles(id);
    }

    @GetMapping("/repos/{id}/files/content")
    public SourceFileDetailDto getFileContent(@PathVariable Long id, @RequestParam String path) {
        return analysisService.getSourceFileDetail(id, path);
    }

    @GetMapping("/repos/{id}/graph")
    public ArchitectureGraphDto getArchitectureGraph(@PathVariable Long id) {
        return analysisService.getArchitectureGraph(id);
    }

    @GetMapping("/repos/{id}/er-diagram")
    public ErDiagramDto getErDiagram(@PathVariable Long id) {
        return erDiagramService.getErDiagram(id);
    }

    @GetMapping("/repos/{id}/insights")
    public ProjectInsightsDto getProjectInsights(
            @PathVariable Long id,
            @RequestParam(defaultValue = "algorithm") String engine,
            @RequestParam(required = false) String model,
            @RequestParam(defaultValue = "false") boolean refresh
    ) {
        return projectInsightService.getProjectInsights(id, engine, model, refresh);
    }

    @PostMapping("/repos/{id}/ask")
    public CitedAnswerResponseDto askQuestion(
            @PathVariable Long id,
            @Valid @RequestBody AskQuestionRequest request
    ) {
        return analysisService.askQuestion(id, request);
    }

    @GetMapping("/repos/{id}/history")
    public List<CitedAnswerResponseDto> getAnalysisHistory(@PathVariable Long id) {
        return analysisService.listAnalysisHistory(id);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntimeException(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", ex.getMessage() != null ? ex.getMessage() : "Unexpected server error"));
    }
}
