package com.visualrepo.model;

import jakarta.persistence.*;

@Entity
@Table(name = "dependency_edges", indexes = {
    @Index(name = "idx_edge_repo", columnList = "repository_id")
})
public class DependencyEdgeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "repository_id", nullable = false)
    private RepositoryEntity repository;

    @Column(nullable = false, length = 512)
    private String sourceFilePath;

    @Column(nullable = false, length = 512)
    private String targetFilePath;

    @Column(nullable = false, length = 64)
    private String relationType;

    @Column(length = 255)
    private String targetSymbol;

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

    public String getSourceFilePath() {
        return sourceFilePath;
    }

    public void setSourceFilePath(String sourceFilePath) {
        this.sourceFilePath = sourceFilePath;
    }

    public String getTargetFilePath() {
        return targetFilePath;
    }

    public void setTargetFilePath(String targetFilePath) {
        this.targetFilePath = targetFilePath;
    }

    public String getRelationType() {
        return relationType;
    }

    public void setRelationType(String relationType) {
        this.relationType = relationType;
    }

    public String getTargetSymbol() {
        return targetSymbol;
    }

    public void setTargetSymbol(String targetSymbol) {
        this.targetSymbol = targetSymbol;
    }
}
