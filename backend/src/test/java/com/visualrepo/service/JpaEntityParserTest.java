package com.visualrepo.service;

import com.visualrepo.dto.ApiDtos.ErColumnDto;
import com.visualrepo.dto.ApiDtos.ErDiagramDto;
import com.visualrepo.dto.ApiDtos.ErEntityDto;
import com.visualrepo.dto.ApiDtos.ErRelationDto;
import com.visualrepo.service.JpaEntityParser.SourceInput;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class JpaEntityParserTest {

    private final JpaEntityParser parser = new JpaEntityParser();

    private static final String BASE_ENTITY = """
            package demo.model;

            import jakarta.persistence.GeneratedValue;
            import jakarta.persistence.GenerationType;
            import jakarta.persistence.Id;
            import jakarta.persistence.MappedSuperclass;

            @MappedSuperclass
            public class BaseEntity {

                @Id
                @GeneratedValue(strategy = GenerationType.IDENTITY)
                private Integer id;

                public Integer getId() { return id; }
            }
            """;

    private static final String OWNER = """
            package demo.owner;

            import jakarta.persistence.*;
            import jakarta.validation.constraints.NotBlank;
            import java.util.ArrayList;
            import java.util.List;

            @Entity
            @Table(name = "owners")
            public class Owner extends BaseEntity {

                @Column(name = "first_name")
                @NotBlank
                private String firstName;

                // a comment with an annotation: @Entity @Table(name = "fake")
                private String telephone;

                @OneToMany(cascade = CascadeType.ALL, fetch = FetchType.EAGER)
                @JoinColumn(name = "owner_id")
                private List<Pet> pets = new ArrayList<>();

                public String getFirstName() { return firstName; }
            }
            """;

    private static final String PET = """
            package demo.owner;

            import jakarta.persistence.*;
            import java.time.LocalDate;
            import java.util.Set;

            @Entity
            @Table(name = "pets")
            public class Pet extends BaseEntity {

                private String name;

                @Column(name = "birth_date")
                private LocalDate birthDate;

                @ManyToOne
                @JoinColumn(name = "type_id")
                private PetType type;

                @OneToMany(mappedBy = "pet", cascade = CascadeType.ALL)
                private Set<Visit> visits;

                @Transient
                private String cached;

                private static final String CONSTANT = "x";
            }
            """;

    private static final String PET_TYPE = """
            package demo.owner;

            import jakarta.persistence.*;

            @Entity
            public class PetType extends BaseEntity {
                private String name;
            }
            """;

    private static final String VISIT = """
            package demo.owner;

            import jakarta.persistence.*;
            import java.math.BigDecimal;

            @Entity
            @Table(name = "visits")
            public class Visit extends BaseEntity {

                @ManyToOne(optional = false)
                private Pet pet;

                @Column(precision = 10, scale = 3, nullable = false)
                private BigDecimal cost;

                @Enumerated(EnumType.STRING)
                private VisitStatus status;

                @ManyToMany
                @JoinTable(name = "visit_vets")
                private java.util.List<Vet> vets;
            }
            """;

    private static final String VET = """
            package demo.owner;

            import jakarta.persistence.*;

            @Entity
            class Vet extends BaseEntity {
                private String lastName;
            }
            """;

    private ErDiagramDto parseAll() {
        return parser.parse(1L, "demo/clinic", List.of(
                new SourceInput("model/BaseEntity.java", BASE_ENTITY),
                new SourceInput("owner/Owner.java", OWNER),
                new SourceInput("owner/Pet.java", PET),
                new SourceInput("owner/PetType.java", PET_TYPE),
                new SourceInput("owner/Visit.java", VISIT),
                new SourceInput("owner/Vet.java", VET)
        ));
    }

    private static ErEntityDto entity(ErDiagramDto d, String className) {
        return d.entities().stream().filter(e -> e.className().equals(className)).findFirst().orElseThrow();
    }

    private static ErColumnDto column(ErEntityDto e, String name) {
        return e.columns().stream().filter(c -> c.name().equals(name)).findFirst().orElseThrow();
    }

    @Test
    void findsEntitiesButNotMappedSuperclasses() {
        ErDiagramDto d = parseAll();
        assertThat(d.entities()).extracting(ErEntityDto::className)
                .containsExactlyInAnyOrder("Owner", "Pet", "PetType", "Visit", "Vet");
    }

    @Test
    void usesTableAnnotationOrSnakeCaseClassName() {
        ErDiagramDto d = parseAll();
        assertThat(entity(d, "Owner").tableName()).isEqualTo("owners");
        assertThat(entity(d, "PetType").tableName()).isEqualTo("pet_type");
    }

    @Test
    void inheritsColumnsFromMappedSuperclassAndIgnoresTransientAndStatic() {
        ErEntityDto pet = entity(parseAll(), "Pet");
        // owner_id is added by Owner's unidirectional @OneToMany + @JoinColumn; "cached" and CONSTANT are skipped
        assertThat(pet.columns()).extracting(ErColumnDto::name)
                .containsExactly("id", "name", "birth_date", "type_id", "owner_id");
        ErColumnDto id = column(pet, "id");
        assertThat(id.primaryKey()).isTrue();
        assertThat(id.nullable()).isFalse();
        assertThat(id.filePath()).isEqualTo("model/BaseEntity.java");
    }

    @Test
    void mapsColumnDetails() {
        ErEntityDto visit = entity(parseAll(), "Visit");
        ErColumnDto cost = column(visit, "cost");
        assertThat(cost.sqlType()).isEqualTo("DECIMAL(10,3)");
        assertThat(cost.nullable()).isFalse();
        assertThat(column(visit, "status").sqlType()).isEqualTo("VARCHAR(255)");
        ErEntityDto owner = entity(parseAll(), "Owner");
        assertThat(column(owner, "first_name").nullable()).isFalse();
        assertThat(column(owner, "telephone").sqlType()).isEqualTo("VARCHAR(255)");
    }

    @Test
    void ignoresAnnotationsInsideComments() {
        ErDiagramDto d = parseAll();
        assertThat(d.entities()).hasSize(5);
    }

    @Test
    void manyToOneCreatesForeignKeyAndRelation() {
        ErDiagramDto d = parseAll();
        ErColumnDto typeFk = column(entity(d, "Pet"), "type_id");
        assertThat(typeFk.foreignKey()).isTrue();
        assertThat(typeFk.references()).isEqualTo("pet_type.id");
        assertThat(typeFk.sqlType()).isEqualTo("INT");

        assertThat(d.relations()).anyMatch(r -> r.source().equals("Pet")
                && r.target().equals("PetType") && r.type().equals("MANY_TO_ONE")
                && "type_id".equals(r.joinColumn()));

        // default FK name follows <field>_<referenced pk>
        ErColumnDto petFk = column(entity(d, "Visit"), "pet_id");
        assertThat(petFk.references()).isEqualTo("pets.id");
        assertThat(petFk.nullable()).isFalse();
    }

    @Test
    void unidirectionalOneToManyAddsForeignKeyToChildTable() {
        ErDiagramDto d = parseAll();
        ErColumnDto ownerFk = column(entity(d, "Pet"), "owner_id");
        assertThat(ownerFk.foreignKey()).isTrue();
        assertThat(ownerFk.references()).isEqualTo("owners.id");
        assertThat(d.relations()).anyMatch(r -> r.source().equals("Owner")
                && r.target().equals("Pet") && r.type().equals("ONE_TO_MANY"));
    }

    @Test
    void inverseSideOfBidirectionalRelationIsNotDrawnTwice() {
        ErDiagramDto d = parseAll();
        // Pet.visits(mappedBy = "pet") is the inverse of Visit.pet
        assertThat(d.relations()).noneMatch(r -> r.source().equals("Pet") && r.target().equals("Visit"));
        assertThat(d.relations()).anyMatch(r -> r.source().equals("Visit") && r.target().equals("Pet"));
    }

    @Test
    void manyToManyUsesJoinTable() {
        ErDiagramDto d = parseAll();
        ErRelationDto rel = d.relations().stream()
                .filter(r -> r.type().equals("MANY_TO_MANY")).findFirst().orElseThrow();
        assertThat(rel.source()).isEqualTo("Visit");
        assertThat(rel.target()).isEqualTo("Vet");
        assertThat(rel.joinTable()).isEqualTo("visit_vets");
    }

    @Test
    void reportsLineNumbersForClassAndFields() {
        ErEntityDto owner = entity(parseAll(), "Owner");
        assertThat(owner.startLine()).isEqualTo(8);
        assertThat(owner.endLine()).isGreaterThan(owner.startLine());
        ErColumnDto first = column(owner, "first_name");
        assertThat(first.filePath()).isEqualTo("owner/Owner.java");
        assertThat(first.line()).isEqualTo(14);
    }

    @Test
    void parsesSingleEntityWithoutRelations() {
        String order = """
                package com.acme;

                import jakarta.persistence.Entity;
                import jakarta.persistence.Id;
                import jakarta.persistence.Table;

                @Entity
                @Table(name = "order_ledger")
                public class OrderRecord {
                    @Id
                    private String id;
                    private String customerId;
                    private java.math.BigDecimal amount;
                    private java.time.Instant createdAt;

                    public OrderRecord() {}
                    public String getId() { return id; }
                }
                """;
        ErDiagramDto d = parser.parse(1L, "demo/x", List.of(new SourceInput("OrderRecord.java", order)));
        assertThat(d.entities()).hasSize(1);
        ErEntityDto e = d.entities().get(0);
        assertThat(e.tableName()).isEqualTo("order_ledger");
        assertThat(e.columns()).extracting(ErColumnDto::name)
                .containsExactly("id", "customer_id", "amount", "created_at");
        assertThat(column(e, "created_at").sqlType()).isEqualTo("TIMESTAMP");
        assertThat(d.relations()).isEmpty();
    }

    @Test
    void ignoresNonEntityAndNonJavaFiles() {
        ErDiagramDto d = parser.parse(1L, "demo/x", List.of(
                new SourceInput("A.java", "public class A { private int x; }"),
                new SourceInput("a.ts", "@Entity class B {}")
        ));
        assertThat(d.entities()).isEmpty();
    }
}
