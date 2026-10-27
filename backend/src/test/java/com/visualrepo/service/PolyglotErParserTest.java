package com.visualrepo.service;

import com.visualrepo.dto.ApiDtos.ErColumnDto;
import com.visualrepo.dto.ApiDtos.ErDiagramDto;
import com.visualrepo.dto.ApiDtos.ErEntityDto;
import com.visualrepo.dto.ApiDtos.ErRelationDto;
import com.visualrepo.service.JpaEntityParser.SourceInput;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PolyglotErParserTest {

    private final PolyglotErParser parser = new PolyglotErParser(new JpaEntityParser());

    @Test
    void extractsSqliteChromaAndDataclassesFromPythonRagRepository() {
        List<SourceInput> files = List.of(
                new SourceInput("backend/config.py", """
                        class Config:
                            OLLAMA_HOST = "http://localhost:11434"
                        """),
                new SourceInput("backend/services/document_store.py", """
                        import sqlite3

                        _SCHEMA = \"\"\"
                        CREATE TABLE IF NOT EXISTS documents (
                            id           TEXT PRIMARY KEY,
                            filename     TEXT NOT NULL,
                            stored_name  TEXT NOT NULL,
                            extension    TEXT NOT NULL,
                            size_bytes   INTEGER NOT NULL,
                            chunks       INTEGER NOT NULL DEFAULT 0,
                            pages        INTEGER,
                            status       TEXT NOT NULL DEFAULT 'ready',
                            error        TEXT,
                            created_at   TEXT NOT NULL
                        );
                        \"\"\"

                        class DocumentStore:
                            pass
                        """),
                new SourceInput("backend/rag/vectorstore.py", """
                        import chromadb

                        class VectorStore:
                            def __init__(self):
                                self._collection = self._client.get_or_create_collection(name="rag")

                            def add(self, document_id, chunks, embeddings):
                                self._collection.upsert(
                                    ids=[c["id"] for c in chunks],
                                    documents=[c["text"] for c in chunks],
                                    embeddings=embeddings,
                                    metadatas=[c["metadata"] for c in chunks],
                                )

                            def delete_document(self, document_id: str) -> None:
                                self._collection.delete(where={"document_id": document_id})
                        """),
                new SourceInput("backend/rag/chunking.py", """
                        from dataclasses import dataclass, field
                        from typing import Any

                        @dataclass
                        class Chunk:
                            text: str
                            index: int
                            metadata: dict[str, Any] = field(default_factory=dict)
                        """),
                new SourceInput("backend/rag/loader.py", """
                        from dataclasses import dataclass

                        class UnsupportedFileType(ValueError):
                            pass

                        @dataclass
                        class ParsedDocument:
                            text: str
                            pages: int | None = None
                            page_texts: list[str] | None = None
                        """)
        );

        ErDiagramDto dto = parser.parse(3L, "MojaveMix/RAG-AI", files);

        assertEquals(4, dto.entities().size(), "Should extract documents, vector_chunks, chunk, and parsed_document (ignoring Config and UnsupportedFileType)");

        ErEntityDto docs = dto.entities().stream()
                .filter(e -> e.tableName().equals("documents"))
                .findFirst().orElseThrow();
        assertEquals("DocumentStore", docs.className());
        assertEquals(10, docs.columns().size());
        ErColumnDto idCol = docs.columns().get(0);
        assertEquals("id", idCol.name());
        assertTrue(idCol.primaryKey());
        assertFalse(idCol.nullable());

        ErEntityDto vector = dto.entities().stream()
                .filter(e -> e.tableName().equals("vector_chunks"))
                .findFirst().orElseThrow();
        assertEquals("VectorStore", vector.className());
        ErColumnDto docFk = vector.columns().stream()
                .filter(c -> c.name().equals("document_id"))
                .findFirst().orElseThrow();
        assertTrue(docFk.foreignKey());
        assertEquals("documents.id", docFk.references());

        // Check relations linking vector_chunks, chunk, and parsed_document to documents
        assertFalse(dto.relations().isEmpty());
        assertTrue(dto.relations().stream()
                .anyMatch(r -> r.source().equals("VectorStore") && r.target().equals("DocumentStore")));
        assertTrue(dto.relations().stream()
                .anyMatch(r -> r.source().equals("Chunk") && r.target().equals("DocumentStore")));
        assertTrue(dto.relations().stream()
                .anyMatch(r -> r.source().equals("ParsedDocument") && r.target().equals("DocumentStore")));
    }

    @Test
    void extractsPrismaAndSqlAlchemyModels() {
        List<SourceInput> files = List.of(
                new SourceInput("prisma/schema.prisma", """
                        model User {
                          id    String @id @default(cuid())
                          email String @unique
                          posts Post[]
                        }

                        model Post {
                          id       String  @id @default(cuid())
                          title    String
                          authorId String
                          author   User    @relation(fields: [authorId], references: [id])
                        }
                        """)
        );

        ErDiagramDto dto = parser.parse(10L, "acme/blog", files);
        assertEquals(2, dto.entities().size());
        assertEquals(1, dto.relations().size());
        ErRelationDto rel = dto.relations().get(0);
        assertEquals("Post", rel.source());
        assertEquals("User", rel.target());
        assertEquals("MANY_TO_ONE", rel.type());
    }
}
