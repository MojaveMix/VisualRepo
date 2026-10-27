package com.visualrepo.service;

import com.visualrepo.dto.ApiDtos.ErColumnDto;
import com.visualrepo.dto.ApiDtos.ErDiagramDto;
import com.visualrepo.dto.ApiDtos.ErEntityDto;
import com.visualrepo.dto.ApiDtos.ErRelationDto;
import com.visualrepo.service.JpaEntityParser.SourceInput;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Multi-language Entity-Relationship (ER) schema extractor.
 *
 * <p>Extracts database tables, collections, data models, and relationships from:
 * <ul>
 *   <li>Java / Kotlin JPA &amp; Hibernate {@code @Entity} classes (via {@link JpaEntityParser})</li>
 *   <li>SQL DDL {@code CREATE TABLE} statements in {@code .sql} files or embedded in Python/JS/TS/Java/Go source files</li>
 *   <li>ChromaDB / VectorStore collections ({@code get_or_create_collection}, {@code upsert})</li>
 *   <li>Python SQLAlchemy, SQLModel, Django ORM models, Pydantic {@code BaseModel}, and {@code @dataclass} models</li>
 *   <li>Prisma {@code model} definitions ({@code .prisma})</li>
 *   <li>TypeScript / JavaScript Mongoose schemas, TypeORM entities, and domain interfaces</li>
 * </ul>
 */
@Component
public class PolyglotErParser {

    private final JpaEntityParser jpaEntityParser;

    public PolyglotErParser(JpaEntityParser jpaEntityParser) {
        this.jpaEntityParser = jpaEntityParser;
    }

    private static final class MutableCol {
        String name;
        String fieldName;
        String javaType;
        String sqlType;
        boolean primaryKey;
        boolean foreignKey;
        boolean nullable = true;
        boolean unique;
        String references;
        String filePath;
        int line;
        String explicitTargetTable;
        String explicitTargetCol;
    }

    private static final class MutableEntity {
        String id;
        String className;
        String tableName;
        String filePath;
        int startLine;
        int endLine;
        String kind; // "JPA", "SQL", "VECTOR", "PYTHON_ORM", "PYTHON_MODEL", "PRISMA", "TS_MODEL"
        List<MutableCol> columns = new ArrayList<>();

        MutableCol primaryKey() {
            for (MutableCol c : columns) {
                if (c.primaryKey) {
                    return c;
                }
            }
            for (MutableCol c : columns) {
                if ("id".equalsIgnoreCase(c.name) || "index".equalsIgnoreCase(c.name)) {
                    return c;
                }
            }
            return columns.isEmpty() ? null : columns.get(0);
        }

        boolean hasColumn(String colName) {
            for (MutableCol c : columns) {
                if (c.name != null && c.name.equalsIgnoreCase(colName)) {
                    return true;
                }
            }
            return false;
        }
    }

    private record PendingRelation(
            String sourceEntityId,
            String targetHint,
            String relationType,
            String fieldName,
            String joinColumn
    ) {}

    private static final Pattern CREATE_TABLE_HEADER = Pattern.compile(
            "(?i)\\bCREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([`\"'\\w.]+)\\s*\\(");

    private static final Pattern PY_CLASS_HEADER = Pattern.compile(
            "(?m)^([ \\t]*)(?:@([\\w.]+)(?:\\([^\\n]*\\))?\\s*\\n\\s*)*class\\s+(\\w+)\\s*(?:\\(([^)]*)\\))?\\s*:");

    private static final Pattern PRISMA_MODEL = Pattern.compile(
            "(?m)^\\s*model\\s+(\\w+)\\s*\\{([^}]*)\\}");

    public ErDiagramDto parse(Long repositoryId, String repoFullName, List<SourceInput> files) {
        if (files == null || files.isEmpty()) {
            return new ErDiagramDto(repositoryId, repoFullName, List.of(), List.of());
        }

        // 1. Run JPA Entity Parser on .java files first
        ErDiagramDto jpaResult = jpaEntityParser.parse(repositoryId, repoFullName, files);
        Map<String, MutableEntity> entitiesByKey = new LinkedHashMap<>();
        List<ErRelationDto> relations = new ArrayList<>(jpaResult.relations());
        List<PendingRelation> pendingRelations = new ArrayList<>();
        Set<String> usedIds = new HashSet<>();

        for (ErEntityDto e : jpaResult.entities()) {
            MutableEntity me = new MutableEntity();
            me.id = e.id();
            me.className = e.className();
            me.tableName = e.tableName();
            me.filePath = e.filePath();
            me.startLine = e.startLine();
            me.endLine = e.endLine();
            me.kind = "JPA";
            for (ErColumnDto c : e.columns()) {
                MutableCol mc = new MutableCol();
                mc.name = c.name();
                mc.fieldName = c.fieldName();
                mc.javaType = c.javaType();
                mc.sqlType = c.sqlType();
                mc.primaryKey = c.primaryKey();
                mc.foreignKey = c.foreignKey();
                mc.nullable = c.nullable();
                mc.unique = c.unique();
                mc.references = c.references();
                mc.filePath = c.filePath();
                mc.line = c.line();
                me.columns.add(mc);
            }
            usedIds.add(me.id);
            entitiesByKey.put(me.tableName.toLowerCase(Locale.ROOT), me);
        }

        // 2. Scan all files for SQL CREATE TABLE statements, VectorStore collections, Prisma models, and Python/TS models
        List<MutableEntity> tsFallbackCandidates = new ArrayList<>();

        for (SourceInput file : files) {
            if (file.path() == null || file.content() == null || file.content().isBlank()) {
                continue;
            }
            String path = file.path();
            String content = file.content();
            int[] newlines = newlineOffsets(content);

            // 2a. SQL CREATE TABLE (in .sql or embedded in .py, .ts, .js, .java, .go, etc.)
            if (content.toUpperCase(Locale.ROOT).contains("CREATE TABLE")) {
                extractSqlTables(path, content, newlines, entitiesByKey, usedIds, pendingRelations);
            }

            // 2b. VectorStore / ChromaDB collection
            if (content.contains("get_or_create_collection") || content.contains("create_collection")) {
                extractVectorStoreCollections(path, content, newlines, entitiesByKey, usedIds, pendingRelations);
            }

            // 2c. Prisma schema
            if (path.endsWith(".prisma")) {
                extractPrismaModels(path, content, newlines, entitiesByKey, usedIds, pendingRelations);
            }

            // 2d. Python ORM (SQLAlchemy, Django, SQLModel) & Data Models (@dataclass, BaseModel, TypedDict)
            if (path.endsWith(".py")) {
                extractPythonModels(path, content, newlines, entitiesByKey, usedIds, pendingRelations);
            }

            // 2e. TypeScript / JavaScript Mongoose schemas or TypeORM entities or domain interfaces
            if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js") || path.endsWith(".jsx")) {
                extractMongooseAndTypeOrm(path, content, newlines, entitiesByKey, usedIds, pendingRelations, tsFallbackCandidates);
            }
        }

        // If no entities were found at all, use TypeScript domain interfaces if available
        if (entitiesByKey.isEmpty() && !tsFallbackCandidates.isEmpty()) {
            for (MutableEntity cand : tsFallbackCandidates) {
                entitiesByKey.putIfAbsent(cand.tableName.toLowerCase(Locale.ROOT), cand);
            }
        }

        // 3. Resolve relationships & foreign keys across all extracted entities
        resolveAllRelationships(entitiesByKey, relations, pendingRelations);

        // 4. Convert to DTOs
        List<ErEntityDto> entityDtos = new ArrayList<>();
        for (MutableEntity me : entitiesByKey.values()) {
            if (me.columns.isEmpty()) {
                continue;
            }
            List<ErColumnDto> colDtos = new ArrayList<>();
            for (MutableCol c : me.columns) {
                colDtos.add(new ErColumnDto(
                        c.name,
                        c.fieldName != null ? c.fieldName : c.name,
                        c.javaType != null ? c.javaType : "String",
                        c.sqlType != null ? c.sqlType : "VARCHAR(255)",
                        c.primaryKey,
                        c.foreignKey,
                        c.nullable,
                        c.unique,
                        c.references,
                        c.filePath != null ? c.filePath : me.filePath,
                        c.line > 0 ? c.line : me.startLine
                ));
            }
            entityDtos.add(new ErEntityDto(
                    me.id,
                    me.className,
                    me.tableName,
                    me.filePath,
                    me.startLine,
                    me.endLine,
                    colDtos
            ));
        }

        return new ErDiagramDto(repositoryId, repoFullName, entityDtos, relations);
    }

    // =========================================================================
    // 1. SQL CREATE TABLE Extractor
    // =========================================================================

    private void extractSqlTables(
            String path,
            String content,
            int[] newlines,
            Map<String, MutableEntity> entitiesByKey,
            Set<String> usedIds,
            List<PendingRelation> pendingRelations
    ) {
        Matcher m = CREATE_TABLE_HEADER.matcher(content);
        while (m.find()) {
            String rawTableName = cleanIdentifier(m.group(1));
            if (rawTableName == null || rawTableName.isEmpty()) {
                continue;
            }
            int dot = rawTableName.lastIndexOf('.');
            String tableName = dot >= 0 ? rawTableName.substring(dot + 1) : rawTableName;
            String tableKey = tableName.toLowerCase(Locale.ROOT);
            if (entitiesByKey.containsKey(tableKey)) {
                continue;
            }

            int openParenOffset = m.end() - 1;
            int closeParenOffset = findMatchingParen(content, openParenOffset);
            if (closeParenOffset <= openParenOffset) {
                continue;
            }

            String body = content.substring(openParenOffset + 1, closeParenOffset);
            int bodyStartOffset = openParenOffset + 1;

            int startLine = lineOf(newlines, m.start());
            int endLine = lineOf(newlines, closeParenOffset);

            // Check if there is an enclosing class in the same file (e.g., DocumentStore in document_store.py)
            String enclosingClass = findEnclosingOrNearbyClassName(content, m.start(), tableName);
            String id = allocateId(enclosingClass, usedIds);

            MutableEntity entity = new MutableEntity();
            entity.id = id;
            entity.className = enclosingClass;
            entity.tableName = tableName;
            entity.filePath = path;
            entity.startLine = startLine;
            entity.endLine = endLine;
            entity.kind = "SQL";

            List<SqlClauseSlice> clauses = splitTopLevelCommas(body, bodyStartOffset);
            Set<String> tableLevelPks = new HashSet<>();
            Set<String> tableLevelUniques = new HashSet<>();
            Map<String, String[]> tableLevelFks = new HashMap<>(); // col -> [targetTable, targetCol]

            for (SqlClauseSlice clause : clauses) {
                String text = stripSqlLineComments(clause.text()).trim();
                if (text.isEmpty()) {
                    continue;
                }
                String upper = text.toUpperCase(Locale.ROOT);

                // Table-level PRIMARY KEY (col1, col2)
                Matcher pkMatcher = Pattern.compile("(?i)^(?:CONSTRAINT\\s+\\S+\\s+)?PRIMARY\\s+KEY\\s*\\(([^)]+)\\)").matcher(text);
                if (pkMatcher.find()) {
                    for (String pkCol : pkMatcher.group(1).split(",")) {
                        tableLevelPks.add(cleanIdentifier(pkCol).toLowerCase(Locale.ROOT));
                    }
                    continue;
                }

                // Table-level FOREIGN KEY (col) REFERENCES other_table(other_col)
                Matcher fkMatcher = Pattern.compile(
                        "(?i)^(?:CONSTRAINT\\s+\\S+\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s*REFERENCES\\s+([`\"'\\w.]+)\\s*(?:\\(([^)]+)\\))?"
                ).matcher(text);
                if (fkMatcher.find()) {
                    String fkCol = cleanIdentifier(fkMatcher.group(1).split(",")[0]);
                    String refTable = cleanIdentifier(fkMatcher.group(2));
                    String refCol = fkMatcher.group(3) != null ? cleanIdentifier(fkMatcher.group(3).split(",")[0]) : "id";
                    tableLevelFks.put(fkCol.toLowerCase(Locale.ROOT), new String[]{refTable, refCol});
                    continue;
                }

                // Table-level UNIQUE (col)
                Matcher uqMatcher = Pattern.compile("(?i)^(?:CONSTRAINT\\s+\\S+\\s+)?UNIQUE\\s*(?:KEY|INDEX)?\\s*\\(([^)]+)\\)").matcher(text);
                if (uqMatcher.find()) {
                    for (String uqCol : uqMatcher.group(1).split(",")) {
                        tableLevelUniques.add(cleanIdentifier(uqCol).toLowerCase(Locale.ROOT));
                    }
                    continue;
                }

                if (upper.startsWith("CONSTRAINT ") || upper.startsWith("CHECK ") || upper.startsWith("CHECK(")
                        || upper.startsWith("INDEX ") || upper.startsWith("KEY ") || upper.startsWith("FULLTEXT ")) {
                    continue;
                }

                // Column definition: col_name TYPE [constraints...]
                Matcher colMatcher = Pattern.compile("^(?s)\\s*([`\"'\\w]+)\\s+([A-Za-z][\\w]*(?:\\s*\\([^)]*\\))?)\\b(.*)$").matcher(text);
                if (!colMatcher.find()) {
                    continue;
                }
                String colName = cleanIdentifier(colMatcher.group(1));
                if (colName == null || colName.isEmpty()) {
                    continue;
                }
                String colUpper = colName.toUpperCase(Locale.ROOT);
                if (Set.of("PRIMARY", "FOREIGN", "UNIQUE", "CONSTRAINT", "CHECK", "INDEX", "KEY").contains(colUpper)) {
                    continue;
                }

                String rawSqlType = colMatcher.group(2).trim().toUpperCase(Locale.ROOT);
                String rest = colMatcher.group(3) != null ? colMatcher.group(3) : "";
                String restUpper = rest.toUpperCase(Locale.ROOT);

                MutableCol col = new MutableCol();
                col.name = colName;
                col.fieldName = colName;
                col.sqlType = rawSqlType;
                col.javaType = codeTypeFromSql(rawSqlType, path);
                col.primaryKey = restUpper.contains("PRIMARY KEY");
                col.unique = col.primaryKey || restUpper.contains("UNIQUE");
                col.nullable = !(col.primaryKey || restUpper.contains("NOT NULL"));
                col.filePath = path;
                col.line = lineOf(newlines, clause.offsetInFile());

                Matcher inlineRef = Pattern.compile("(?i)\\bREFERENCES\\s+([`\"'\\w.]+)\\s*(?:\\(([^)]+)\\))?").matcher(rest);
                if (inlineRef.find()) {
                    col.foreignKey = true;
                    col.explicitTargetTable = cleanIdentifier(inlineRef.group(1));
                    col.explicitTargetCol = inlineRef.group(2) != null ? cleanIdentifier(inlineRef.group(2)) : "id";
                }

                entity.columns.add(col);
            }

            // Apply table-level constraints
            for (MutableCol col : entity.columns) {
                String key = col.name.toLowerCase(Locale.ROOT);
                if (tableLevelPks.contains(key)) {
                    col.primaryKey = true;
                    col.nullable = false;
                }
                if (tableLevelUniques.contains(key)) {
                    col.unique = true;
                }
                if (tableLevelFks.containsKey(key)) {
                    String[] target = tableLevelFks.get(key);
                    col.foreignKey = true;
                    col.explicitTargetTable = target[0];
                    col.explicitTargetCol = target[1];
                }
                if (col.explicitTargetTable != null) {
                    pendingRelations.add(new PendingRelation(
                            entity.id, col.explicitTargetTable, "MANY_TO_ONE", col.fieldName, col.name));
                }
            }

            if (!entity.columns.isEmpty()) {
                entitiesByKey.put(tableKey, entity);
            }
        }
    }

    // =========================================================================
    // 2. VectorStore / ChromaDB Collection Extractor
    // =========================================================================

    private void extractVectorStoreCollections(
            String path,
            String content,
            int[] newlines,
            Map<String, MutableEntity> entitiesByKey,
            Set<String> usedIds,
            List<PendingRelation> pendingRelations
    ) {
        int collIdx = content.indexOf("get_or_create_collection");
        if (collIdx < 0) {
            collIdx = content.indexOf("create_collection");
        }
        if (collIdx < 0) {
            return;
        }

        String className = findEnclosingOrNearbyClassName(content, collIdx, "VectorCollection");
        String tableName = "vector_chunks";
        if (entitiesByKey.containsKey(tableName)) {
            return;
        }

        int startLine = 1;
        int endLine = lineOf(newlines, content.length() - 1);
        Matcher classMatcher = Pattern.compile("(?m)^class\\s+" + Pattern.quote(className) + "\\b").matcher(content);
        if (classMatcher.find()) {
            startLine = lineOf(newlines, classMatcher.start());
        } else {
            startLine = lineOf(newlines, collIdx);
        }

        MutableEntity entity = new MutableEntity();
        entity.id = allocateId(className, usedIds);
        entity.className = className;
        entity.tableName = tableName;
        entity.filePath = path;
        entity.startLine = startLine;
        entity.endLine = endLine;
        entity.kind = "VECTOR";

        // Primary key: id
        int idsLine = findLineContaining(content, newlines, "ids=", startLine);
        MutableCol idCol = new MutableCol();
        idCol.name = "id";
        idCol.fieldName = "ids";
        idCol.javaType = path.endsWith(".py") ? "str" : "String";
        idCol.sqlType = "TEXT";
        idCol.primaryKey = true;
        idCol.nullable = false;
        idCol.unique = true;
        idCol.filePath = path;
        idCol.line = idsLine;
        entity.columns.add(idCol);

        // Check for foreign key metadata filter (e.g., document_id)
        Matcher fkFilter = Pattern.compile("\"(\\w+_id)\"").matcher(content);
        Set<String> addedFks = new HashSet<>();
        while (fkFilter.find()) {
            String fkName = fkFilter.group(1);
            if (addedFks.add(fkName)) {
                MutableCol fkCol = new MutableCol();
                fkCol.name = fkName;
                fkCol.fieldName = fkName;
                fkCol.javaType = path.endsWith(".py") ? "str" : "String";
                fkCol.sqlType = "TEXT";
                fkCol.foreignKey = true;
                fkCol.nullable = false;
                fkCol.filePath = path;
                fkCol.line = lineOf(newlines, fkFilter.start());
                entity.columns.add(fkCol);
            }
        }

        // Document text column
        int docsLine = findLineContaining(content, newlines, "documents=", startLine);
        MutableCol docCol = new MutableCol();
        docCol.name = "document";
        docCol.fieldName = "documents";
        docCol.javaType = path.endsWith(".py") ? "str" : "String";
        docCol.sqlType = "TEXT";
        docCol.nullable = false;
        docCol.filePath = path;
        docCol.line = docsLine;
        entity.columns.add(docCol);

        // Embedding vector column
        int embLine = findLineContaining(content, newlines, "embeddings=", startLine);
        MutableCol embCol = new MutableCol();
        embCol.name = "embedding";
        embCol.fieldName = "embeddings";
        embCol.javaType = path.endsWith(".py") ? "list[float]" : "float[]";
        embCol.sqlType = "VECTOR(FLOAT)";
        embCol.nullable = false;
        embCol.filePath = path;
        embCol.line = embLine;
        entity.columns.add(embCol);

        // Metadata JSON column
        int metaLine = findLineContaining(content, newlines, "metadatas=", startLine);
        MutableCol metaCol = new MutableCol();
        metaCol.name = "metadata";
        metaCol.fieldName = "metadatas";
        metaCol.javaType = path.endsWith(".py") ? "dict[str, Any]" : "Map<String, Object>";
        metaCol.sqlType = "JSON";
        metaCol.nullable = true;
        metaCol.filePath = path;
        metaCol.line = metaLine;
        entity.columns.add(metaCol);

        entitiesByKey.put(tableName, entity);
    }

    // =========================================================================
    // 3. Python Models Extractor (SQLAlchemy, Django, SQLModel, Pydantic, @dataclass)
    // =========================================================================

    private void extractPythonModels(
            String path,
            String content,
            int[] newlines,
            Map<String, MutableEntity> entitiesByKey,
            Set<String> usedIds,
            List<PendingRelation> pendingRelations
    ) {
        String[] lines = content.split("\n", -1);
        int i = 0;
        while (i < lines.length) {
            String line = lines[i];
            String trimmed = line.trim();

            boolean hasDataclassDecorator = false;
            int decoratorStartLine = i + 1;
            while (trimmed.startsWith("@") && i + 1 < lines.length) {
                if (trimmed.startsWith("@dataclass")) {
                    hasDataclassDecorator = true;
                }
                i++;
                line = lines[i];
                trimmed = line.trim();
            }

            Matcher classMatcher = Pattern.compile("^([ \\t]*)class\\s+(\\w+)\\s*(?:\\(([^)]*)\\))?\\s*:").matcher(line);
            if (!classMatcher.find()) {
                i++;
                continue;
            }

            String classIndent = classMatcher.group(1);
            String className = classMatcher.group(2);
            String bases = classMatcher.group(3) != null ? classMatcher.group(3).trim() : "";
            int classStartLine = hasDataclassDecorator ? decoratorStartLine : (i + 1);

            // Find end of Python class block by indentation
            int blockEndLineIdx = i + 1;
            while (blockEndLineIdx < lines.length) {
                String bl = lines[blockEndLineIdx];
                String bt = bl.trim();
                if (!bt.isEmpty() && !bt.startsWith("#")) {
                    int indentLen = countIndent(bl);
                    if (indentLen <= countIndent(classIndent) && !bt.startsWith(")") && !bt.startsWith("]") && !bt.startsWith("}")) {
                        break;
                    }
                }
                blockEndLineIdx++;
            }

            int classEndLine = blockEndLineIdx;
            while (classEndLine > classStartLine && lines[classEndLine - 1].trim().isEmpty()) {
                classEndLine--;
            }

            boolean isOrmModel = isPythonOrmBase(bases) || hasTablenameAttr(lines, i + 1, blockEndLineIdx);
            boolean isDataModel = hasDataclassDecorator || isPythonDataModelBase(bases);

            if ((isOrmModel || isDataModel) && !isIgnoredClassName(className, bases)) {
                String explicitTable = extractPythonTablename(lines, i + 1, blockEndLineIdx);
                String tableName = explicitTable != null ? explicitTable : JpaEntityParser.snake(className);
                String tableKey = tableName.toLowerCase(Locale.ROOT);

                if (!entitiesByKey.containsKey(tableKey)) {
                    MutableEntity entity = new MutableEntity();
                    entity.id = allocateId(className, usedIds);
                    entity.className = className;
                    entity.tableName = tableName;
                    entity.filePath = path;
                    entity.startLine = classStartLine;
                    entity.endLine = classEndLine;
                    entity.kind = isOrmModel ? "PYTHON_ORM" : "PYTHON_MODEL";

                    parsePythonClassFields(lines, i + 1, blockEndLineIdx, path, entity, pendingRelations);

                    if (!entity.columns.isEmpty()) {
                        // Ensure at least one primary key if an `id` or `index` column exists
                        boolean hasPk = false;
                        for (MutableCol c : entity.columns) {
                            if (c.primaryKey) {
                                hasPk = true;
                                break;
                            }
                        }
                        if (!hasPk) {
                            for (MutableCol c : entity.columns) {
                                if ("id".equalsIgnoreCase(c.name) || "index".equalsIgnoreCase(c.name)) {
                                    c.primaryKey = true;
                                    c.nullable = false;
                                    break;
                                }
                            }
                        }
                        entitiesByKey.put(tableKey, entity);
                    }
                }
            }

            i = blockEndLineIdx;
        }
    }

    private void parsePythonClassFields(
            String[] lines,
            int fromIdx,
            int toIdx,
            String path,
            MutableEntity entity,
            List<PendingRelation> pendingRelations
    ) {
        int classBodyIndent = -1;
        boolean inDocstring = false;
        String docstringDelim = null;

        for (int idx = fromIdx; idx < toIdx; idx++) {
            String rawLine = lines[idx];
            String trimmed = rawLine.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                continue;
            }

            // Handle multi-line docstrings
            if (inDocstring) {
                if (trimmed.contains(docstringDelim)) {
                    inDocstring = false;
                }
                continue;
            }
            if (trimmed.startsWith("\"\"\"") || trimmed.startsWith("'''")) {
                String delim = trimmed.substring(0, 3);
                if (trimmed.length() == 3 || !trimmed.substring(3).contains(delim)) {
                    inDocstring = true;
                    docstringDelim = delim;
                }
                continue;
            }

            int indent = countIndent(rawLine);
            if (classBodyIndent < 0) {
                classBodyIndent = indent;
            }
            if (indent > classBodyIndent) {
                continue; // Inside a method or nested block
            }
            if (trimmed.startsWith("def ") || trimmed.startsWith("async def ") || trimmed.startsWith("@") || trimmed.startsWith("class ")) {
                continue;
            }

            // 1. SQLAlchemy / Django assignment: field = Column(...) / models.CharField(...) / relationship(...)
            Matcher ormAssign = Pattern.compile("^(\\w+)\\s*(?::\\s*[^=]+)?=\\s*(.+)$").matcher(trimmed);
            if (ormAssign.find()) {
                String fieldName = ormAssign.group(1);
                String rhs = ormAssign.group(2).trim();
                if (fieldName.startsWith("_")) {
                    continue;
                }

                // SQLAlchemy relationship(...)
                Matcher relMatcher = Pattern.compile("\\brelationship\\s*\\(\\s*[\"'](\\w+)[\"']").matcher(rhs);
                if (relMatcher.find()) {
                    pendingRelations.add(new PendingRelation(
                            entity.id, relMatcher.group(1), "ONE_TO_MANY", fieldName, null));
                    continue;
                }

                // SQLAlchemy Column(...) / mapped_column(...) / SQLModel Field(...)
                if (rhs.contains("Column(") || rhs.contains("mapped_column(") || rhs.contains("Field(")) {
                    MutableCol col = new MutableCol();
                    col.name = fieldName;
                    col.fieldName = fieldName;
                    col.javaType = extractPythonColumnType(rhs);
                    col.sqlType = pythonTypeToSql(col.javaType);
                    col.primaryKey = rhs.contains("primary_key=True") || rhs.contains("primary_key = True");
                    col.unique = col.primaryKey || rhs.contains("unique=True");
                    col.nullable = !(col.primaryKey || rhs.contains("nullable=False"));
                    col.filePath = path;
                    col.line = idx + 1;

                    Matcher fk = Pattern.compile("ForeignKey\\s*\\(\\s*[\"']([\\w.]+)[\"']").matcher(rhs);
                    if (!fk.find()) {
                        fk = Pattern.compile("foreign_key\\s*=\\s*[\"']([\\w.]+)[\"']").matcher(rhs);
                    }
                    if (fk.find()) {
                        col.foreignKey = true;
                        String[] parts = fk.group(1).split("\\.");
                        col.explicitTargetTable = parts[0];
                        col.explicitTargetCol = parts.length > 1 ? parts[1] : "id";
                        pendingRelations.add(new PendingRelation(
                                entity.id, col.explicitTargetTable, "MANY_TO_ONE", fieldName, fieldName));
                    }
                    entity.columns.add(col);
                    continue;
                }

                // Django models.<Field>(...)
                Matcher djangoField = Pattern.compile("\\bmodels\\.(\\w+Field)\\s*\\((.*)\\)").matcher(rhs);
                if (djangoField.find()) {
                    String fType = djangoField.group(1);
                    String fArgs = djangoField.group(2);
                    MutableCol col = new MutableCol();
                    col.fieldName = fieldName;
                    col.filePath = path;
                    col.line = idx + 1;

                    if ("ForeignKey".equals(fType) || "OneToOneField".equals(fType)) {
                        String target = cleanIdentifier(fArgs.split(",")[0].replace("to=", "").trim());
                        col.name = fieldName.endsWith("_id") ? fieldName : fieldName + "_id";
                        col.javaType = target;
                        col.sqlType = "BIGINT";
                        col.foreignKey = true;
                        col.unique = "OneToOneField".equals(fType);
                        col.nullable = fArgs.contains("null=True");
                        col.explicitTargetTable = target;
                        pendingRelations.add(new PendingRelation(
                                entity.id, target, "OneToOneField".equals(fType) ? "ONE_TO_ONE" : "MANY_TO_ONE", fieldName, col.name));
                        entity.columns.add(col);
                    } else if ("ManyToManyField".equals(fType)) {
                        String target = cleanIdentifier(fArgs.split(",")[0].replace("to=", "").trim());
                        pendingRelations.add(new PendingRelation(
                                entity.id, target, "MANY_TO_MANY", fieldName, null));
                    } else {
                        col.name = fieldName;
                        col.javaType = fType.replace("Field", "");
                        col.sqlType = djangoFieldToSql(fType, fArgs);
                        col.primaryKey = fArgs.contains("primary_key=True") || "AutoField".equals(fType) || "BigAutoField".equals(fType);
                        col.unique = col.primaryKey || fArgs.contains("unique=True");
                        col.nullable = !col.primaryKey && fArgs.contains("null=True");
                        entity.columns.add(col);
                    }
                    continue;
                }
            }

            // 2. Typed Python field (@dataclass / Pydantic BaseModel / SQLModel): field_name: type [= default]
            Matcher typedField = Pattern.compile("^(\\w+)\\s*:\\s*([^=#]+?)(?:\\s*=\\s*(.+))?$").matcher(trimmed);
            if (typedField.find()) {
                String fieldName = typedField.group(1).trim();
                String rawType = typedField.group(2).trim();
                String defaultVal = typedField.group(3) != null ? typedField.group(3).trim() : null;
                if (fieldName.startsWith("_") || "ClassVar".equals(rawType) || rawType.startsWith("ClassVar[")) {
                    continue;
                }

                boolean nullable = rawType.contains("None") || rawType.startsWith("Optional[") || "None".equals(defaultVal);
                String cleanType = rawType
                        .replaceAll("\\s*\\|\\s*None", "")
                        .replaceAll("^Optional\\[(.*)\\]$", "$1")
                        .trim();

                MutableCol col = new MutableCol();
                col.name = fieldName;
                col.fieldName = fieldName;
                col.javaType = cleanType;
                col.sqlType = pythonTypeToSql(cleanType);
                col.primaryKey = "id".equalsIgnoreCase(fieldName);
                col.nullable = !col.primaryKey && nullable;
                col.filePath = path;
                col.line = idx + 1;
                entity.columns.add(col);
            }
        }
    }

    // =========================================================================
    // 4. Prisma Schema Extractor (.prisma)
    // =========================================================================

    private void extractPrismaModels(
            String path,
            String content,
            int[] newlines,
            Map<String, MutableEntity> entitiesByKey,
            Set<String> usedIds,
            List<PendingRelation> pendingRelations
    ) {
        Matcher m = PRISMA_MODEL.matcher(content);
        while (m.find()) {
            String modelName = m.group(1);
            String body = m.group(2);
            int startLine = lineOf(newlines, m.start());
            int endLine = lineOf(newlines, m.end() - 1);

            String tableName = JpaEntityParser.snake(modelName);
            Matcher mapMatcher = Pattern.compile("@@map\\(\\s*\"([^\"]+)\"\\s*\\)").matcher(body);
            if (mapMatcher.find()) {
                tableName = mapMatcher.group(1);
            }

            String tableKey = tableName.toLowerCase(Locale.ROOT);
            if (entitiesByKey.containsKey(tableKey)) {
                continue;
            }

            MutableEntity entity = new MutableEntity();
            entity.id = allocateId(modelName, usedIds);
            entity.className = modelName;
            entity.tableName = tableName;
            entity.filePath = path;
            entity.startLine = startLine;
            entity.endLine = endLine;
            entity.kind = "PRISMA";

            int bodyOffset = m.start(2);
            String[] lines = body.split("\n", -1);
            int curOffset = bodyOffset;
            for (String line : lines) {
                String trimmed = line.trim();
                int lineNumber = lineOf(newlines, curOffset);
                curOffset += line.length() + 1;

                if (trimmed.isEmpty() || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
                    continue;
                }
                Matcher fm = Pattern.compile("^(\\w+)\\s+([\\w?\\[\\]]+)(.*)$").matcher(trimmed);
                if (!fm.find()) {
                    continue;
                }
                String fName = fm.group(1);
                String fType = fm.group(2);
                String attrs = fm.group(3) != null ? fm.group(3) : "";

                if (fType.endsWith("[]")) {
                    continue; // Inverse array side of relation
                }
                Matcher relAttr = Pattern.compile("@relation\\([^)]*fields:\\s*\\[(\\w+)\\]").matcher(attrs);
                if (relAttr.find()) {
                    String fkField = relAttr.group(1);
                    String targetModel = fType.replace("?", "");
                    pendingRelations.add(new PendingRelation(entity.id, targetModel, "MANY_TO_ONE", fName, fkField));
                    continue;
                }

                MutableCol col = new MutableCol();
                col.name = fName;
                col.fieldName = fName;
                col.javaType = fType.replace("?", "");
                col.sqlType = prismaTypeToSql(col.javaType);
                col.primaryKey = attrs.contains("@id");
                col.unique = col.primaryKey || attrs.contains("@unique");
                col.nullable = !col.primaryKey && fType.endsWith("?");
                col.filePath = path;
                col.line = lineNumber;
                entity.columns.add(col);
            }

            if (!entity.columns.isEmpty()) {
                entitiesByKey.put(tableKey, entity);
            }
        }
    }

    // =========================================================================
    // 5. TypeScript / JavaScript Mongoose & Domain Interface Extractor
    // =========================================================================

    private void extractMongooseAndTypeOrm(
            String path,
            String content,
            int[] newlines,
            Map<String, MutableEntity> entitiesByKey,
            Set<String> usedIds,
            List<PendingRelation> pendingRelations,
            List<MutableEntity> tsFallbackCandidates
    ) {
        // Check for TypeScript interfaces in model/schema/types files as fallback candidates
        if (path.endsWith(".ts") || path.endsWith(".tsx")) {
            Matcher iface = Pattern.compile("(?m)^\\s*(?:export\\s+)?interface\\s+(\\w+)\\s*\\{([^}]*)\\}").matcher(content);
            while (iface.find()) {
                String name = iface.group(1);
                if (name.endsWith("Props") || name.endsWith("State") || name.endsWith("Context") || name.endsWith("Config")) {
                    continue;
                }
                String body = iface.group(2);
                MutableEntity entity = new MutableEntity();
                entity.id = allocateId(name, usedIds);
                entity.className = name;
                entity.tableName = JpaEntityParser.snake(name);
                entity.filePath = path;
                entity.startLine = lineOf(newlines, iface.start());
                entity.endLine = lineOf(newlines, iface.end() - 1);
                entity.kind = "TS_MODEL";

                int curOffset = iface.start(2);
                for (String line : body.split("\n", -1)) {
                    int ln = lineOf(newlines, curOffset);
                    curOffset += line.length() + 1;
                    String trimmed = line.trim();
                    Matcher fm = Pattern.compile("^(\\w+)(\\?)?\\s*:\\s*([^;,]+)").matcher(trimmed);
                    if (fm.find()) {
                        String fn = fm.group(1);
                        boolean opt = fm.group(2) != null;
                        String ft = fm.group(3).trim();
                        MutableCol col = new MutableCol();
                        col.name = fn;
                        col.fieldName = fn;
                        col.javaType = ft;
                        col.sqlType = pythonTypeToSql(ft);
                        col.primaryKey = "id".equalsIgnoreCase(fn);
                        col.nullable = !col.primaryKey && opt;
                        col.filePath = path;
                        col.line = ln;
                        entity.columns.add(col);
                    }
                }
                if (entity.columns.size() >= 2) {
                    tsFallbackCandidates.add(entity);
                }
            }
        }
    }

    // =========================================================================
    // 6. Cross-Entity Relationship & Foreign Key Resolution
    // =========================================================================

    private void resolveAllRelationships(
            Map<String, MutableEntity> entitiesByKey,
            List<ErRelationDto> relations,
            List<PendingRelation> pendingRelations
    ) {
        if (entitiesByKey.isEmpty()) {
            return;
        }

        Set<String> existingEdgeKeys = new HashSet<>();
        for (ErRelationDto r : relations) {
            existingEdgeKeys.add(r.source() + "->" + r.target() + ":" + r.fieldName());
        }
        int relCounter = relations.size() + 1;

        // 1. Resolve explicit pending relations (from SQL REFERENCES, ORM ForeignKey, Prisma @relation)
        for (PendingRelation pr : pendingRelations) {
            MutableEntity source = findEntityById(entitiesByKey, pr.sourceEntityId());
            MutableEntity target = findEntityMatchingName(entitiesByKey, pr.targetHint());
            if (source == null || target == null || source.id.equals(target.id)) {
                continue;
            }
            MutableCol targetPk = target.primaryKey();
            String pkName = targetPk != null ? targetPk.name : "id";
            if (pr.joinColumn() != null) {
                for (MutableCol c : source.columns) {
                    if (c.name.equalsIgnoreCase(pr.joinColumn())) {
                        c.foreignKey = true;
                        c.references = target.tableName + "." + pkName;
                    }
                }
            }
            String edgeKey = source.id + "->" + target.id + ":" + pr.fieldName();
            if (existingEdgeKeys.add(edgeKey)) {
                relations.add(new ErRelationDto(
                        "rel-" + relCounter++,
                        source.id,
                        target.id,
                        pr.relationType(),
                        pr.fieldName(),
                        pr.joinColumn(),
                        null
                ));
            }
        }

        // 2. Resolve naming-convention foreign keys: `<target>_id` or `<target>Id`
        for (MutableEntity source : entitiesByKey.values()) {
            for (MutableCol col : source.columns) {
                if (col.primaryKey && "id".equalsIgnoreCase(col.name)) {
                    continue;
                }
                String prefix = extractFkPrefix(col.name);
                if (prefix == null) {
                    continue;
                }
                MutableEntity target = findEntityMatchingName(entitiesByKey, prefix);
                if (target == null || target.id.equals(source.id)) {
                    continue;
                }
                MutableCol targetPk = target.primaryKey();
                String pkName = targetPk != null ? targetPk.name : "id";
                col.foreignKey = true;
                col.references = target.tableName + "." + pkName;

                String edgeKey = source.id + "->" + target.id + ":" + col.fieldName;
                if (existingEdgeKeys.add(edgeKey)) {
                    relations.add(new ErRelationDto(
                            "rel-" + relCounter++,
                            source.id,
                            target.id,
                            "MANY_TO_ONE",
                            col.fieldName,
                            col.name,
                            null
                    ));
                }
            }
        }

        // 3. Resolve field-type references (e.g., field of type `Chunk` or `list[Chunk]`)
        for (MutableEntity source : entitiesByKey.values()) {
            for (MutableCol col : source.columns) {
                if (col.foreignKey || col.javaType == null) {
                    continue;
                }
                String baseType = extractInnerType(col.javaType);
                if (isPrimitiveOrBuiltinType(baseType)) {
                    continue;
                }
                MutableEntity target = findEntityMatchingName(entitiesByKey, baseType);
                if (target == null || target.id.equals(source.id)) {
                    continue;
                }
                boolean isCollection = col.javaType.contains("[") || col.javaType.startsWith("List") || col.javaType.startsWith("Set");
                String relType = isCollection ? "ONE_TO_MANY" : "MANY_TO_ONE";
                String edgeKey = source.id + "->" + target.id + ":" + col.fieldName;
                if (existingEdgeKeys.add(edgeKey)) {
                    if (!isCollection) {
                        MutableCol targetPk = target.primaryKey();
                        col.foreignKey = true;
                        col.references = target.tableName + "." + (targetPk != null ? targetPk.name : "id");
                    }
                    relations.add(new ErRelationDto(
                            "rel-" + relCounter++,
                            source.id,
                            target.id,
                            relType,
                            col.fieldName,
                            isCollection ? null : col.name,
                            null
                    ));
                }
            }
        }

        // 4. Resolve domain/collection column linkage (e.g., `documents.chunks` <-> `chunk` entity, `documents.pages` <-> `parsed_document`)
        for (MutableEntity parent : entitiesByKey.values()) {
            for (MutableCol col : parent.columns) {
                if (col.primaryKey || col.foreignKey) {
                    continue;
                }
                MutableEntity child = findEntityByTableOrSingular(entitiesByKey, col.name);
                if (child != null && !child.id.equals(parent.id) && !hasAnyEdgeBetween(relations, child.id, parent.id)) {
                    MutableCol parentPk = parent.primaryKey();
                    String pkName = parentPk != null ? parentPk.name : "id";
                    String edgeKey = child.id + "->" + parent.id + ":" + col.name;
                    if (existingEdgeKeys.add(edgeKey)) {
                        relations.add(new ErRelationDto(
                                "rel-" + relCounter++,
                                child.id,
                                parent.id,
                                "MANY_TO_ONE",
                                col.name,
                                parent.tableName + "." + pkName,
                                null
                        ));
                    }
                }
            }
        }

        // 5. Connect standalone data models (like ParsedDocument) that share domain attributes with a primary table
        for (MutableEntity model : entitiesByKey.values()) {
            if (!"PYTHON_MODEL".equals(model.kind) || hasAnyEdgeInvolving(relations, model.id)) {
                continue;
            }
            for (MutableEntity table : entitiesByKey.values()) {
                if (table.id.equals(model.id) || "PYTHON_MODEL".equals(table.kind)) {
                    continue;
                }
                // Check if model name contains table singular name (e.g., ParsedDocument -> documents)
                String singularTable = singularize(table.tableName.toLowerCase(Locale.ROOT));
                if (model.tableName.toLowerCase(Locale.ROOT).contains(singularTable)) {
                    String sharedCol = findSharedColumnName(model, table);
                    String edgeKey = model.id + "->" + table.id + ":" + (sharedCol != null ? sharedCol : singularTable);
                    if (existingEdgeKeys.add(edgeKey)) {
                        relations.add(new ErRelationDto(
                                "rel-" + relCounter++,
                                model.id,
                                table.id,
                                "ONE_TO_ONE",
                                sharedCol != null ? sharedCol : singularTable + "_id",
                                table.tableName + ".id",
                                null
                        ));
                        break;
                    }
                }
            }
        }
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    private record SqlClauseSlice(String text, int offsetInFile) {}

    private static List<SqlClauseSlice> splitTopLevelCommas(String body, int baseOffset) {
        List<SqlClauseSlice> list = new ArrayList<>();
        int depth = 0;
        int start = 0;
        for (int i = 0; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth = Math.max(0, depth - 1);
            } else if (c == ',' && depth == 0) {
                int lead = 0;
                while (start + lead < i && Character.isWhitespace(body.charAt(start + lead))) {
                    lead++;
                }
                list.add(new SqlClauseSlice(body.substring(start, i), baseOffset + start + lead));
                start = i + 1;
            }
        }
        if (start < body.length()) {
            int lead = 0;
            while (start + lead < body.length() && Character.isWhitespace(body.charAt(start + lead))) {
                lead++;
            }
            list.add(new SqlClauseSlice(body.substring(start), baseOffset + start + lead));
        }
        return list;
    }

    private static String stripSqlLineComments(String s) {
        return s.replaceAll("(?m)--.*$", "").replaceAll("(?m)#.*$", "");
    }

    private static int findMatchingParen(String s, int openIdx) {
        int depth = 0;
        for (int i = openIdx; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
                if (depth == 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    private static String findEnclosingOrNearbyClassName(String content, int targetOffset, String fallbackTableName) {
        Matcher m = Pattern.compile("(?m)^\\s*(?:public\\s+)?class\\s+(\\w+)").matcher(content);
        String bestBefore = null;
        String firstInFile = null;
        while (m.find()) {
            String name = m.group(1);
            if (firstInFile == null) {
                firstInFile = name;
            }
            if (m.start() <= targetOffset) {
                bestBefore = name;
            }
        }
        if (bestBefore != null) {
            return bestBefore;
        }
        if (firstInFile != null) {
            return firstInFile;
        }
        return pascalCase(fallbackTableName);
    }

    private static int findLineContaining(String content, int[] newlines, String needle, int fallbackLine) {
        int idx = content.indexOf(needle);
        return idx >= 0 ? lineOf(newlines, idx) : fallbackLine;
    }

    private static String allocateId(String base, Set<String> usedIds) {
        String id = base;
        int n = 2;
        while (!usedIds.add(id)) {
            id = base + "#" + n++;
        }
        return id;
    }

    private static boolean isPythonOrmBase(String bases) {
        if (bases == null || bases.isEmpty()) {
            return false;
        }
        for (String b : bases.split(",")) {
            String t = b.trim();
            if (t.equals("Base") || t.endsWith(".Base") || t.equals("Model") || t.endsWith(".Model")
                    || t.equals("DeclarativeBase") || t.startsWith("SQLModel")) {
                return true;
            }
        }
        return false;
    }

    private static boolean isPythonDataModelBase(String bases) {
        if (bases == null || bases.isEmpty()) {
            return false;
        }
        for (String b : bases.split(",")) {
            String t = b.trim();
            if (t.equals("BaseModel") || t.endsWith(".BaseModel")
                    || t.equals("TypedDict") || t.endsWith(".TypedDict")
                    || t.equals("Schema") || t.endsWith("Schema")) {
                return true;
            }
        }
        return false;
    }

    private static boolean isIgnoredClassName(String className, String bases) {
        String lower = className.toLowerCase(Locale.ROOT);
        if (lower.equals("config") || lower.endsWith("config") || lower.endsWith("settings")
                || lower.endsWith("error") || lower.endsWith("exception") || lower.endsWith("client")) {
            return true;
        }
        if (bases != null) {
            String bl = bases.toLowerCase(Locale.ROOT);
            if (bl.contains("error") || bl.contains("exception") || bl.contains("settings")) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasTablenameAttr(String[] lines, int from, int to) {
        return extractPythonTablename(lines, from, to) != null;
    }

    private static String extractPythonTablename(String[] lines, int from, int to) {
        for (int i = from; i < to; i++) {
            Matcher m = Pattern.compile("^\\s*__tablename__\\s*=\\s*[\"']([^\"']+)[\"']").matcher(lines[i]);
            if (m.find()) {
                return m.group(1).trim();
            }
        }
        return null;
    }

    private static String extractPythonColumnType(String rhs) {
        Matcher m = Pattern.compile("(?:Column|mapped_column)\\s*\\(\\s*([A-Za-z]\\w*(?:\\([^)]*\\))?)").matcher(rhs);
        if (m.find()) {
            String t = m.group(1);
            if (!t.startsWith("ForeignKey") && !t.startsWith("primary_key")) {
                return t;
            }
        }
        return "str";
    }

    private static String pythonTypeToSql(String pyType) {
        if (pyType == null) {
            return "VARCHAR(255)";
        }
        String t = pyType.trim();
        String lower = t.toLowerCase(Locale.ROOT);
        if (lower.equals("str") || lower.equals("string") || lower.startsWith("varchar")) {
            return "TEXT";
        }
        if (lower.equals("int") || lower.equals("integer") || lower.equals("number")) {
            return "INT";
        }
        if (lower.equals("bigint") || lower.equals("biginteger")) {
            return "BIGINT";
        }
        if (lower.equals("float") || lower.equals("double") || lower.equals("real")) {
            return "FLOAT";
        }
        if (lower.equals("decimal") || lower.equals("numeric")) {
            return "DECIMAL(19,2)";
        }
        if (lower.equals("bool") || lower.equals("boolean")) {
            return "BOOLEAN";
        }
        if (lower.startsWith("dict") || lower.startsWith("map") || lower.startsWith("record") || lower.equals("json") || lower.equals("any")) {
            return "JSON";
        }
        if (lower.startsWith("list[str]") || lower.equals("string[]")) {
            return "TEXT[]";
        }
        if (lower.startsWith("list[float]") || lower.equals("float[]") || lower.equals("number[]")) {
            return "FLOAT[]";
        }
        if (lower.startsWith("list") || lower.endsWith("[]")) {
            return "ARRAY";
        }
        if (lower.contains("datetime") || lower.contains("timestamp")) {
            return "TIMESTAMP";
        }
        if (lower.equals("date")) {
            return "DATE";
        }
        if (lower.equals("uuid")) {
            return "UUID";
        }
        if (lower.equals("bytes") || lower.equals("blob")) {
            return "BLOB";
        }
        return t.toUpperCase(Locale.ROOT);
    }

    private static String djangoFieldToSql(String fieldType, String args) {
        return switch (fieldType) {
            case "CharField", "SlugField", "EmailField", "URLField" -> "VARCHAR(255)";
            case "TextField" -> "TEXT";
            case "IntegerField", "PositiveIntegerField", "SmallIntegerField" -> "INT";
            case "BigIntegerField", "BigAutoField", "AutoField" -> "BIGINT";
            case "BooleanField" -> "BOOLEAN";
            case "FloatField" -> "FLOAT";
            case "DecimalField" -> "DECIMAL(19,2)";
            case "DateTimeField" -> "TIMESTAMP";
            case "DateField" -> "DATE";
            case "UUIDField" -> "UUID";
            case "JSONField" -> "JSON";
            default -> "VARCHAR(255)";
        };
    }

    private static String prismaTypeToSql(String prismaType) {
        return switch (prismaType) {
            case "String" -> "TEXT";
            case "Int" -> "INT";
            case "BigInt" -> "BIGINT";
            case "Float" -> "FLOAT";
            case "Decimal" -> "DECIMAL(19,2)";
            case "Boolean" -> "BOOLEAN";
            case "DateTime" -> "TIMESTAMP";
            case "Json" -> "JSON";
            case "Bytes" -> "BLOB";
            default -> prismaType.toUpperCase(Locale.ROOT);
        };
    }

    private static String codeTypeFromSql(String sqlType, String path) {
        String u = sqlType.toUpperCase(Locale.ROOT);
        boolean isPy = path != null && path.endsWith(".py");
        if (u.startsWith("INT") || u.equals("INTEGER") || u.equals("SMALLINT") || u.equals("BIGINT")) {
            return isPy ? "int" : "Long";
        }
        if (u.startsWith("REAL") || u.startsWith("FLOAT") || u.startsWith("DOUBLE") || u.startsWith("DECIMAL") || u.startsWith("NUMERIC")) {
            return isPy ? "float" : "BigDecimal";
        }
        if (u.startsWith("BOOL")) {
            return isPy ? "bool" : "Boolean";
        }
        if (u.startsWith("JSON")) {
            return isPy ? "dict" : "Map";
        }
        if (u.startsWith("BLOB") || u.startsWith("BYTEA")) {
            return isPy ? "bytes" : "byte[]";
        }
        return isPy ? "str" : "String";
    }

    private static String extractFkPrefix(String colName) {
        if (colName == null) {
            return null;
        }
        if (colName.endsWith("_id") && colName.length() > 3) {
            return colName.substring(0, colName.length() - 3);
        }
        if (colName.endsWith("Id") && colName.length() > 2 && Character.isLowerCase(colName.charAt(0))) {
            return JpaEntityParser.snake(colName.substring(0, colName.length() - 2));
        }
        return null;
    }

    private static MutableEntity findEntityById(Map<String, MutableEntity> map, String id) {
        for (MutableEntity e : map.values()) {
            if (e.id.equals(id)) {
                return e;
            }
        }
        return null;
    }

    private static MutableEntity findEntityMatchingName(Map<String, MutableEntity> map, String rawTarget) {
        if (rawTarget == null || rawTarget.isBlank()) {
            return null;
        }
        String norm = JpaEntityParser.snake(cleanIdentifier(rawTarget)).toLowerCase(Locale.ROOT);
        String singular = singularize(norm);
        String plural = norm + "s";

        for (MutableEntity e : map.values()) {
            String tName = e.tableName.toLowerCase(Locale.ROOT);
            String cName = JpaEntityParser.snake(e.className).toLowerCase(Locale.ROOT);
            String tSingular = singularize(tName);

            if (tName.equals(norm) || tName.equals(singular) || tName.equals(plural)
                    || tSingular.equals(singular)
                    || cName.equals(norm) || cName.equals(singular)
                    || e.className.equalsIgnoreCase(rawTarget)) {
                return e;
            }
        }
        return null;
    }

    private static MutableEntity findEntityByTableOrSingular(Map<String, MutableEntity> map, String colName) {
        if (colName == null) {
            return null;
        }
        String norm = colName.toLowerCase(Locale.ROOT);
        String singular = singularize(norm);
        for (MutableEntity e : map.values()) {
            String tName = e.tableName.toLowerCase(Locale.ROOT);
            if (tName.equals(norm) || tName.equals(singular) || singularize(tName).equals(singular)) {
                return e;
            }
        }
        return null;
    }

    private static boolean hasAnyEdgeBetween(List<ErRelationDto> relations, String idA, String idB) {
        for (ErRelationDto r : relations) {
            if ((r.source().equals(idA) && r.target().equals(idB))
                    || (r.source().equals(idB) && r.target().equals(idA))) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasAnyEdgeInvolving(List<ErRelationDto> relations, String entityId) {
        for (ErRelationDto r : relations) {
            if (r.source().equals(entityId) || r.target().equals(entityId)) {
                return true;
            }
        }
        return false;
    }

    private static String findSharedColumnName(MutableEntity a, MutableEntity b) {
        for (MutableCol ca : a.columns) {
            if ("id".equalsIgnoreCase(ca.name)) {
                continue;
            }
            if (b.hasColumn(ca.name)) {
                return ca.name;
            }
        }
        return null;
    }

    private static String singularize(String word) {
        if (word == null) {
            return "";
        }
        if (word.endsWith("ies") && word.length() > 3) {
            return word.substring(0, word.length() - 3) + "y";
        }
        if (word.endsWith("ses") && word.length() > 3) {
            return word.substring(0, word.length() - 2);
        }
        if (word.endsWith("s") && !word.endsWith("ss") && word.length() > 1) {
            return word.substring(0, word.length() - 1);
        }
        return word;
    }

    private static String extractInnerType(String type) {
        Matcher m = Pattern.compile("(?:list|List|Set|set|Collection)\\s*[\\[<]\\s*(\\w+)\\s*[\\]>]").matcher(type);
        if (m.find()) {
            return m.group(1);
        }
        return type.replace("[]", "").trim();
    }

    private static boolean isPrimitiveOrBuiltinType(String type) {
        if (type == null || type.isEmpty()) {
            return true;
        }
        String l = type.toLowerCase(Locale.ROOT);
        return Set.of(
                "str", "string", "int", "integer", "long", "float", "double", "bool", "boolean",
                "bytes", "byte", "short", "char", "dict", "list", "set", "tuple", "any", "object",
                "void", "none", "null", "number", "bigint", "bigdecimal", "localdate", "localdatetime",
                "instant", "uuid", "date", "datetime", "path", "map"
        ).contains(l);
    }

    private static String cleanIdentifier(String raw) {
        if (raw == null) {
            return null;
        }
        return raw.replace("`", "").replace("\"", "").replace("'", "").trim();
    }

    private static String pascalCase(String snakeOrRaw) {
        if (snakeOrRaw == null || snakeOrRaw.isEmpty()) {
            return "Entity";
        }
        StringBuilder sb = new StringBuilder();
        for (String part : snakeOrRaw.split("[_\\-\\s.]+")) {
            if (!part.isEmpty()) {
                sb.append(Character.toUpperCase(part.charAt(0)));
                if (part.length() > 1) {
                    sb.append(part.substring(1));
                }
            }
        }
        return sb.length() > 0 ? sb.toString() : snakeOrRaw;
    }

    private static int countIndent(String line) {
        int count = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == ' ') {
                count++;
            } else if (c == '\t') {
                count += 4;
            } else {
                break;
            }
        }
        return count;
    }

    private static int[] newlineOffsets(String text) {
        List<Integer> offsets = new ArrayList<>();
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                offsets.add(i);
            }
        }
        return offsets.stream().mapToInt(Integer::intValue).toArray();
    }

    private static int lineOf(int[] newlines, int offset) {
        int idx = Arrays.binarySearch(newlines, Math.max(0, offset));
        int before = idx >= 0 ? idx : -idx - 1;
        return before + 1;
    }
}
