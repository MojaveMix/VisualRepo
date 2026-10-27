package com.visualrepo.repository;

import com.visualrepo.model.RepositoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface RepositoryJpaRepository extends JpaRepository<RepositoryEntity, Long> {
    Optional<RepositoryEntity> findByOwnerIgnoreCaseAndNameIgnoreCase(String owner, String name);
    List<RepositoryEntity> findAllByOrderByLastIndexedAtDescCreatedAtDesc();
}
