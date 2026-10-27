package com.visualrepo.repository;

import com.visualrepo.model.SourceFileEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SourceFileJpaRepository extends JpaRepository<SourceFileEntity, Long> {
    List<SourceFileEntity> findByRepositoryIdOrderByPathAsc(Long repositoryId);
    Optional<SourceFileEntity> findByRepositoryIdAndPath(Long repositoryId, String path);
    void deleteByRepositoryId(Long repositoryId);
}
