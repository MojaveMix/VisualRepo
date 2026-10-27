package com.visualrepo.model;

import jakarta.persistence.*;

@Entity
@Table(name = "code_chunks", indexes = {
    @Index(name = "idx_chunk_repo_file", columnList = "repository_id, filePath")
})
public class CodeChunkEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "repository_id", nullable = false)
    private RepositoryEntity repository;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "source_file_id", nullable = false)
    private SourceFileEntity sourceFile;

    @Column(nullable = false, length = 512)
    private String filePath;

    @Column(nullable = false)
    private int startLine;

    @Column(nullable = false)
    private int endLine;

    @Column(nullable = false, length = 255)
    private String symbolName;

    @Column(nullable = false, length = 64)
    private String chunkType;

    @Lob
    @Column(columnDefinition = "LONGTEXT", nullable = false)
    private String content;

    @Lob
    @Column(columnDefinition = "LONGTEXT")
    private String embeddingJson;

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

    public SourceFileEntity getSourceFile() {
        return sourceFile;
    }

    public void setSourceFile(SourceFileEntity sourceFile) {
        this.sourceFile = sourceFile;
    }

    public String getFilePath() {
        return filePath;
    }

    public void setFilePath(String filePath) {
        this.filePath = filePath;
    }

    public int getStartLine() {
        return startLine;
    }

    public void setStartLine(int startLine) {
        this.startLine = startLine;
    }

    public int getEndLine() {
        return endLine;
    }

    public void setEndLine(int endLine) {
        this.endLine = endLine;
    }

    public String getSymbolName() {
        return symbolName;
    }

    public void setSymbolName(String symbolName) {
        this.symbolName = symbolName;
    }

    public String getChunkType() {
        return chunkType;
    }

    public void setChunkType(String chunkType) {
        this.chunkType = chunkType;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getEmbeddingJson() {
        return embeddingJson;
    }

    public void setEmbeddingJson(String embeddingJson) {
        this.embeddingJson = embeddingJson;
    }
}
