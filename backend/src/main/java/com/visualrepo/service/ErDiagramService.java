package com.visualrepo.service;

import com.visualrepo.dto.ApiDtos.ErColumnDto;
import com.visualrepo.dto.ApiDtos.ErDiagramDto;
import com.visualrepo.dto.ApiDtos.ErEntityDto;
import com.visualrepo.dto.ApiDtos.ErRelationDto;
import com.visualrepo.model.RepositoryEntity;
import com.visualrepo.model.SourceFileEntity;
import com.visualrepo.repository.RepositoryJpaRepository;
import com.visualrepo.repository.SourceFileJpaRepository;
import com.visualrepo.service.JpaEntityParser.SourceInput;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/** Builds the database (entity-relationship) diagram of an indexed repository. */
@Service
public class ErDiagramService {

    private final RepositoryJpaRepository repositoryJpa;
    private final SourceFileJpaRepository sourceFileJpa;
    private final PolyglotErParser parser;

    public ErDiagramService(
            RepositoryJpaRepository repositoryJpa,
            SourceFileJpaRepository sourceFileJpa,
            PolyglotErParser parser
    ) {
        this.repositoryJpa = repositoryJpa;
        this.sourceFileJpa = sourceFileJpa;
        this.parser = parser;
    }

    @Transactional(readOnly = true)
    public ErDiagramDto getErDiagram(Long repositoryId) {
        RepositoryEntity repo = repositoryJpa.findById(repositoryId)
                .orElseThrow(() -> new IllegalArgumentException("Repository not found with ID: " + repositoryId));

        List<SourceInput> inputs = sourceFileJpa.findByRepositoryIdOrderByPathAsc(repositoryId)
                .stream()
                .map((SourceFileEntity f) -> new SourceInput(f.getPath(), f.getContent()))
                .toList();

        return parser.parse(repositoryId, repo.getOwner() + "/" + repo.getName(), inputs);
    }
}
