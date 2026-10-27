package com.visualrepo.repository;

import com.visualrepo.model.DependencyEdgeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DependencyEdgeJpaRepository extends JpaRepository<DependencyEdgeEntity, Long> {
    List<DependencyEdgeEntity> findByRepositoryId(Long repositoryId);
    List<DependencyEdgeEntity> findByRepositoryIdAndSourceFilePath(Long repositoryId, String sourceFilePath);
    List<DependencyEdgeEntity> findByRepositoryIdAndTargetFilePath(Long repositoryId, String targetFilePath);
    void deleteByRepositoryId(Long repositoryId);
}
