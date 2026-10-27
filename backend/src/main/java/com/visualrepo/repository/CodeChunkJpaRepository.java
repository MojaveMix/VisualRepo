package com.visualrepo.repository;

import com.visualrepo.model.CodeChunkEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface CodeChunkJpaRepository extends JpaRepository<CodeChunkEntity, Long> {
    List<CodeChunkEntity> findByRepositoryIdOrderByFilePathAscStartLineAsc(Long repositoryId);
    List<CodeChunkEntity> findByRepositoryIdAndFilePathOrderByStartLineAsc(Long repositoryId, String filePath);
    void deleteByRepositoryId(Long repositoryId);
}
