package com.visualrepo.model;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "repositories")
public class RepositoryEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String owner;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 100)
    private String defaultBranch;

    @Column(length = 64)
    private String commitSha;

    @Column(nullable = false, length = 512)
    private String htmlUrl;

    @Column(length = 1000)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private IndexingStatus status = IndexingStatus.PENDING;

    @Column(nullable = false)
    private boolean embeddingsGenerated = false;

    @Column(length = 120)
    private String embeddingModel;

    @Column(nullable = false)
    private int fileCount = 0;

    @Column(nullable = false)
    private int chunkCount = 0;

    @Column(nullable = false)
    private int edgeCount = 0;

    @Column(length = 1000)
    private String errorMessage;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    private Instant lastIndexedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDefaultBranch() {
        return defaultBranch;
    }

    public void setDefaultBranch(String defaultBranch) {
        this.defaultBranch = defaultBranch;
    }

    public String getCommitSha() {
        return commitSha;
    }

    public void setCommitSha(String commitSha) {
        this.commitSha = commitSha;
    }

    public String getHtmlUrl() {
        return htmlUrl;
    }

    public void setHtmlUrl(String htmlUrl) {
        this.htmlUrl = htmlUrl;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public IndexingStatus getStatus() {
        return status;
    }

    public void setStatus(IndexingStatus status) {
        this.status = status;
    }

    public boolean isEmbeddingsGenerated() {
        return embeddingsGenerated;
    }

    public void setEmbeddingsGenerated(boolean embeddingsGenerated) {
        this.embeddingsGenerated = embeddingsGenerated;
    }

    public String getEmbeddingModel() {
        return embeddingModel;
    }

    public void setEmbeddingModel(String embeddingModel) {
        this.embeddingModel = embeddingModel;
    }

    public int getFileCount() {
        return fileCount;
    }

    public void setFileCount(int fileCount) {
        this.fileCount = fileCount;
    }

    public int getChunkCount() {
        return chunkCount;
    }

    public void setChunkCount(int chunkCount) {
        this.chunkCount = chunkCount;
    }

    public int getEdgeCount() {
        return edgeCount;
    }

    public void setEdgeCount(int edgeCount) {
        this.edgeCount = edgeCount;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getLastIndexedAt() {
        return lastIndexedAt;
    }

    public void setLastIndexedAt(Instant lastIndexedAt) {
        this.lastIndexedAt = lastIndexedAt;
    }
}
