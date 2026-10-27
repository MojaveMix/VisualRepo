package com.visualrepo.repository;

import com.visualrepo.model.AnalysisHistoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AnalysisHistoryJpaRepository extends JpaRepository<AnalysisHistoryEntity, Long> {
    List<AnalysisHistoryEntity> findByRepositoryIdOrderByCreatedAtDesc(Long repositoryId);
    void deleteByRepositoryId(Long repositoryId);
}
