package com.visualrepo.model;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "analysis_history", indexes = {
    @Index(name = "idx_history_repo_created", columnList = "repository_id, createdAt")
})
public class AnalysisHistoryEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "repository_id", nullable = false)
    private RepositoryEntity repository;

    @Column(nullable = false, length = 1000)
    private String question;

    @Lob
    @Column(columnDefinition = "LONGTEXT", nullable = false)
    private String answer;

    @Column(length = 1000)
    private String architecturalSummary;

    @Lob
    @Column(columnDefinition = "LONGTEXT", nullable = false)
    private String citationsJson;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private RetrievalMode retrievalMode;

    @Column(nullable = false, length = 120)
    private String modelUsed;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public RepositoryEntity getRepository() {
        return repository;
    }

    public void setRepository(RepositoryEntity repository) {
        this.repository = repository;
    }

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public String getAnswer() {
        return answer;
    }

    public void setAnswer(String answer) {
        this.answer = answer;
    }

    public String getArchitecturalSummary() {
        return architecturalSummary;
    }

    public void setArchitecturalSummary(String architecturalSummary) {
        this.architecturalSummary = architecturalSummary;
    }

    public String getCitationsJson() {
        return citationsJson;
    }

    public void setCitationsJson(String citationsJson) {
        this.citationsJson = citationsJson;
    }

    public RetrievalMode getRetrievalMode() {
        return retrievalMode;
    }

    public void setRetrievalMode(RetrievalMode retrievalMode) {
        this.retrievalMode = retrievalMode;
    }

    public String getModelUsed() {
        return modelUsed;
    }

    public void setModelUsed(String modelUsed) {
        this.modelUsed = modelUsed;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
