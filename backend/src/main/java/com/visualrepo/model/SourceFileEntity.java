package com.visualrepo.model;

import jakarta.persistence.*;

@Entity
@Table(name = "source_files", indexes = {
    @Index(name = "idx_source_file_repo_path", columnList = "repository_id, path")
})
public class SourceFileEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "repository_id", nullable = false)
    private RepositoryEntity repository;

    @Column(nullable = false, length = 512)
    private String path;

    @Column(nullable = false, length = 64)
    private String language;

    @Column(nullable = false, length = 64)
    private String architecturalRole;

    @Column(nullable = false)
    private int lineCount;

    @Column(nullable = false)
    private long sizeBytes;

    @Column(length = 64)
    private String sha;

    @Lob
    @Column(columnDefinition = "LONGTEXT", nullable = false)
    private String content;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String importsJson;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String symbolsJson;

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

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
    }

    public String getArchitecturalRole() {
        return architecturalRole;
    }

    public void setArchitecturalRole(String architecturalRole) {
        this.architecturalRole = architecturalRole;
    }

    public int getLineCount() {
        return lineCount;
    }

    public void setLineCount(int lineCount) {
        this.lineCount = lineCount;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public void setSizeBytes(long sizeBytes) {
        this.sizeBytes = sizeBytes;
    }

    public String getSha() {
        return sha;
    }

    public void setSha(String sha) {
        this.sha = sha;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getImportsJson() {
        return importsJson;
    }

    public void setImportsJson(String importsJson) {
        this.importsJson = importsJson;
    }

    public String getSymbolsJson() {
        return symbolsJson;
    }

    public void setSymbolsJson(String symbolsJson) {
        this.symbolsJson = symbolsJson;
    }
}
