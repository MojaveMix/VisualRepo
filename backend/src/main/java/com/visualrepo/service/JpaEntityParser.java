package com.visualrepo.service;

import com.visualrepo.dto.ApiDtos.ErColumnDto;
import com.visualrepo.dto.ApiDtos.ErDiagramDto;
import com.visualrepo.dto.ApiDtos.ErEntityDto;
import com.visualrepo.dto.ApiDtos.ErRelationDto;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads JPA/Hibernate entities straight from Java source text and turns them into
 * tables, columns and relationships for the entity-relationship diagram.
 *
 * <p>It is a lightweight source scanner (no compilation), so it understands the common
 * annotation patterns: {@code @Entity}, {@code @Table}, {@code @Id}, {@code @Column},
 * {@code @JoinColumn}, {@code @JoinTable}, the four relationship annotations and
 * {@code @MappedSuperclass} inheritance.
 */
@Component
public class JpaEntityParser {

    public record SourceInput(String path, String content) {}

    private record Ann(String name, String args) {}

    private record ParsedAnnotations(List<Ann> annotations, int endOffset) {}

    private static final class RawField {
        String name;
        String type;
        int line;
        String filePath;
        List<Ann> annotations = new ArrayList<>();

        Ann ann(String simpleName) {
            for (Ann a : annotations) {
                if (a.name().equals(simpleName)) {
                    return a;
                }
            }
            return null;
        }

        boolean has(String simpleName) {
            return ann(simpleName) != null;
        }
    }

    private static final class RawClass {
        String name;
        String superName;
        String path;
        boolean entity;
        boolean mappedSuperclass;
        String tableName;
        int startLine;
        int endLine;
        List<RawField> fields = new ArrayList<>();
    }

    private static final class EntityBuild {
        String id;
        RawClass raw;
        String tableName;
        List<MutableColumn> columns = new ArrayList<>();
        Set<String> relationFields = new HashSet<>();

        MutableColumn primaryKey() {
            for (MutableColumn c : columns) {
                if (c.primaryKey) {
                    return c;
                }
            }
            return null;
        }
    }

    private static final class MutableColumn {
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
        String fkTargetClass;
    }

    /**
     * A relationship found on an entity field. {@code mappedBy != null} marks the inverse
     * (non-owning) side of a bidirectional relationship.
     */
    private record RelationIntent(
            EntityBuild owner,
            String targetClass,
            String type,
            String fieldName,
            String joinColumn,
            String joinTable,
            boolean fkOnTarget,
            String mappedBy
    ) {}

    private static final Pattern CLASS_DECL = Pattern.compile(
            "(?s)^[\\s\\w]*?\\bclass\\s+(\\w+)(?:\\s*<[^{]*?>)?(?:\\s+extends\\s+([\\w.]+))?");
    private static final Pattern FIELD_DECL = Pattern.compile(
            "(?s)^((?:(?:public|protected|private|static|final|transient|volatile)\\s+)*)(.+?)\\s+(\\w+)$");
    private static final Pattern CAMEL = Pattern.compile("([a-z0-9])([A-Z])");

    // ------------------------------------------------------------------ public API

    public ErDiagramDto parse(Long repositoryId, String repoFullName, List<SourceInput> files) {
        List<RawClass> classes = new ArrayList<>();
        for (SourceInput f : files) {
            if (f.path() == null || !f.path().endsWith(".java") || f.content() == null) {
                continue;
            }
            if (!f.content().contains("@Entity") && !f.content().contains("@MappedSuperclass")) {
                continue;
            }
            classes.addAll(parseFile(f.path(), f.content()));
        }

        Map<String, RawClass> byName = new HashMap<>();
        for (RawClass c : classes) {
            byName.putIfAbsent(c.name, c);
        }

        // Phase 1: tables and plain columns (inherited columns first)
        Map<String, EntityBuild> entities = new LinkedHashMap<>();
        List<RelationIntent> intents = new ArrayList<>();
        Set<String> usedIds = new HashSet<>();

        for (RawClass c : classes) {
            if (!c.entity) {
                continue;
            }
            EntityBuild eb = new EntityBuild();
            eb.raw = c;
            eb.tableName = c.tableName != null ? c.tableName : snake(c.name);
            String id = c.name;
            int n = 2;
            while (!usedIds.add(id)) {
                id = c.name + "#" + n++;
            }
            eb.id = id;
            entities.put(id, eb);

            for (RawField f : effectiveFields(c, byName)) {
                collectField(eb, f, intents);
            }
        }

        Map<String, EntityBuild> byClass = new HashMap<>();
        for (EntityBuild eb : entities.values()) {
            byClass.putIfAbsent(eb.raw.name, eb);
        }

        // Phase 2: resolve relationships now that every table is known
        List<ErRelationDto> relations = new ArrayList<>();
        int relCounter = 1;
        for (RelationIntent intent : intents) {
            EntityBuild target = byClass.get(intent.targetClass());

            if (intent.mappedBy() != null) {
                // Inverse side of a bidirectional relationship: the owning side draws the edge.
                boolean owningSideMapped = target != null && target.relationFields.contains(intent.mappedBy());
                if (target != null && !owningSideMapped) {
                    relations.add(new ErRelationDto(
                            "rel-" + relCounter++, intent.owner().id, target.id,
                            intent.type(), intent.fieldName(), null, null));
                }
                continue;
            }

            if (target == null) {
                finishUnresolvedForeignKey(intent);
                continue;
            }

            String joinColumn = intent.joinColumn();
            String joinTable = intent.joinTable();
            boolean viaJoinTable = "MANY_TO_MANY".equals(intent.type())
                    || ("ONE_TO_MANY".equals(intent.type()) && !intent.fkOnTarget());
            if (viaJoinTable && joinTable == null) {
                joinTable = intent.owner().tableName + "_" + target.tableName;
            }

            if (intent.fkOnTarget()) {
                // unidirectional @OneToMany + @JoinColumn: the FK lives in the child table
                String fkName = joinColumn != null ? joinColumn : snake(intent.fieldName()) + "_id";
                addForeignKeyColumn(target, fkName, intent.owner(), intent.fieldName());
                joinColumn = fkName;
            } else if ("MANY_TO_ONE".equals(intent.type()) || "ONE_TO_ONE".equals(intent.type())) {
                MutableColumn fk = findForeignKeyColumn(intent.owner(), intent.fieldName());
                if (fk != null) {
                    MutableColumn targetPk = target.primaryKey();
                    if (fk.name == null) {
                        fk.name = snake(intent.fieldName()) + "_" + (targetPk != null ? targetPk.name : "id");
                    }
                    fk.references = target.tableName + "." + (targetPk != null ? targetPk.name : "id");
                    if (targetPk != null) {
                        fk.sqlType = baseSqlType(targetPk.sqlType);
                    }
                    joinColumn = fk.name;
                }
            }

            relations.add(new ErRelationDto(
                    "rel-" + relCounter++,
                    intent.owner().id,
                    target.id,
                    intent.type(),
                    intent.fieldName(),
                    joinColumn,
                    joinTable
            ));
        }

        // Safety net: FK columns whose name is still unknown
        for (EntityBuild eb : entities.values()) {
            for (MutableColumn c : eb.columns) {
                if (c.name == null) {
                    c.name = snake(c.fieldName) + "_id";
                }
            }
        }

        List<ErEntityDto> entityDtos = new ArrayList<>();
        for (EntityBuild eb : entities.values()) {
            List<ErColumnDto> cols = new ArrayList<>();
            for (MutableColumn c : eb.columns) {
                cols.add(new ErColumnDto(
                        c.name, c.fieldName, c.javaType, c.sqlType,
                        c.primaryKey, c.foreignKey, c.nullable, c.unique,
                        c.references, c.filePath, c.line
                ));
            }
            entityDtos.add(new ErEntityDto(
                    eb.id, eb.raw.name, eb.tableName, eb.raw.path,
                    eb.raw.startLine, eb.raw.endLine, cols
            ));
        }

        return new ErDiagramDto(repositoryId, repoFullName, entityDtos, relations);
    }

    // ------------------------------------------------------------------ phase 1 helpers

    private List<RawField> effectiveFields(RawClass c, Map<String, RawClass> byName) {
        List<RawClass> chain = new ArrayList<>();
        RawClass cur = c;
        int guard = 0;
        while (cur != null && guard++ < 10) {
            chain.add(0, cur);
            cur = cur.superName == null ? null : byName.get(simpleName(cur.superName));
            if (cur == c) {
                break;
            }
        }
        List<RawField> all = new ArrayList<>();
        for (RawClass rc : chain) {
            all.addAll(rc.fields);
        }
        return all;
    }

    private void collectField(EntityBuild eb, RawField f, List<RelationIntent> intents) {
        String type = simpleName(stripGenerics(f.type));

        Ann manyToOne = f.ann("ManyToOne");
        Ann oneToOne = f.ann("OneToOne");
        Ann oneToMany = f.ann("OneToMany");
        Ann manyToMany = f.ann("ManyToMany");

        if (f.has("ElementCollection")) {
            return;
        }

        if (manyToOne != null || oneToOne != null) {
            Ann rel = manyToOne != null ? manyToOne : oneToOne;
            String kind = manyToOne != null ? "MANY_TO_ONE" : "ONE_TO_ONE";
            String mappedBy = attr(rel.args(), "mappedBy");
            String target = relationTarget(rel.args(), f.type, false);
            eb.relationFields.add(f.name);
            if (mappedBy != null) {
                // inverse side: no column in this table
                intents.add(new RelationIntent(eb, target, kind, f.name, null, null, false, mappedBy));
                return;
            }
            Ann join = f.ann("JoinColumn");
            String joinName = join != null ? cleanIdentifier(attr(join.args(), "name")) : null;
            MutableColumn col = baseColumn(eb, f);
            col.name = joinName;
            col.foreignKey = true;
            col.fkTargetClass = target;
            col.javaType = target;
            col.sqlType = "BIGINT";
            col.nullable = !(isFalse(rel.args(), "optional")
                    || (join != null && isFalse(join.args(), "nullable"))
                    || hasNotNull(f));
            col.unique = "ONE_TO_ONE".equals(kind);
            eb.columns.add(col);
            intents.add(new RelationIntent(eb, target, kind, f.name, joinName, null, false, null));
            return;
        }

        if (oneToMany != null || manyToMany != null) {
            Ann rel = oneToMany != null ? oneToMany : manyToMany;
            String kind = oneToMany != null ? "ONE_TO_MANY" : "MANY_TO_MANY";
            String mappedBy = attr(rel.args(), "mappedBy");
            String target = relationTarget(rel.args(), f.type, true);
            eb.relationFields.add(f.name);
            if (mappedBy != null) {
                intents.add(new RelationIntent(eb, target, kind, f.name, null, null, false, mappedBy));
                return;
            }
            Ann join = f.ann("JoinColumn");
            Ann joinTable = f.ann("JoinTable");
            if (oneToMany != null && join != null) {
                String joinName = attr(join.args(), "name");
                intents.add(new RelationIntent(eb, target, kind, f.name,
                        joinName != null ? cleanIdentifier(joinName) : null, null, true, null));
            } else {
                String table = joinTable != null ? attr(joinTable.args(), "name") : null;
                intents.add(new RelationIntent(eb, target, kind, f.name, null,
                        table != null ? cleanIdentifier(table) : null, false, null));
            }
            return;
        }

        if (isCollectionType(type)) {
            return; // not a persistent column without @ElementCollection / relationship annotation
        }

        MutableColumn col = baseColumn(eb, f);
        Ann column = f.ann("Column");
        col.name = column != null && attr(column.args(), "name") != null
                ? cleanIdentifier(attr(column.args(), "name"))
                : snake(f.name);
        col.javaType = type + (f.type.trim().endsWith("[]") ? "[]" : "");
        col.sqlType = sqlType(f, type);
        col.primaryKey = f.has("Id") || f.has("EmbeddedId");
        col.unique = column != null && isTrue(column.args(), "unique");
        boolean primitive = Set.of("int", "long", "short", "byte", "boolean", "double", "float", "char").contains(type);
        col.nullable = !(col.primaryKey
                || primitive
                || (column != null && isFalse(column.args(), "nullable"))
                || hasNotNull(f));
        eb.columns.add(col);
    }

    private MutableColumn baseColumn(EntityBuild eb, RawField f) {
        MutableColumn col = new MutableColumn();
        col.fieldName = f.name;
        col.filePath = f.filePath;
        col.line = f.line;
        col.primaryKey = f.has("Id") || f.has("EmbeddedId");
        return col;
    }

    private MutableColumn findForeignKeyColumn(EntityBuild owner, String fieldName) {
        for (MutableColumn c : owner.columns) {
            if (c.foreignKey && fieldName.equals(c.fieldName)) {
                return c;
            }
        }
        return null;
    }

    private void addForeignKeyColumn(EntityBuild table, String columnName, EntityBuild parent, String parentField) {
        for (MutableColumn c : table.columns) {
            if (columnName.equals(c.name)) {
                c.foreignKey = true;
                MutableColumn pk = parent.primaryKey();
                c.references = parent.tableName + "." + (pk != null ? pk.name : "id");
                return;
            }
        }
        MutableColumn pk = parent.primaryKey();
        MutableColumn col = new MutableColumn();
        col.name = columnName;
        col.fieldName = parentField;
        col.javaType = parent.raw.name;
        col.sqlType = pk != null ? baseSqlType(pk.sqlType) : "BIGINT";
        col.foreignKey = true;
        col.nullable = true;
        col.references = parent.tableName + "." + (pk != null ? pk.name : "id");
        col.filePath = parent.raw.path;
        col.line = parent.raw.startLine;
        table.columns.add(col);
    }

    private void finishUnresolvedForeignKey(RelationIntent intent) {
        if (intent.mappedBy() != null || intent.fkOnTarget()) {
            return;
        }
        MutableColumn fk = findForeignKeyColumn(intent.owner(), intent.fieldName());
        if (fk != null && fk.name == null) {
            fk.name = snake(intent.fieldName()) + "_id";
        }
    }

    private static String baseSqlType(String sqlType) {
        return sqlType == null ? "BIGINT" : sqlType;
    }

    // ------------------------------------------------------------------ source scanning

    List<RawClass> parseFile(String path, String source) {
        String text = stripComments(source);
        int[] newlines = newlineOffsets(text);
        List<RawClass> result = new ArrayList<>();

        int n = text.length();
        int i = 0;
        int segStart = 0;
        while (i < n) {
            char c = text.charAt(i);
            if (c == '"' || c == '\'') {
                i = skipLiteral(text, i);
            } else if (c == '(') {
                i = findMatching(text, i, '(', ')') + 1;
            } else if (c == ';') {
                i++;
                segStart = i;
            } else if (c == '{') {
                int close = findMatching(text, i, '{', '}');
                String header = text.substring(segStart, i);
                RawClass rc = parseClassHeader(header, path);
                if (rc != null) {
                    int lead = header.length() - header.stripLeading().length();
                    rc.startLine = lineOf(newlines, segStart + lead);
                    rc.endLine = lineOf(newlines, Math.min(close, n - 1));
                    parseBody(text, newlines, i + 1, close, rc);
                    result.add(rc);
                }
                i = close + 1;
                segStart = i;
            } else {
                i++;
            }
        }
        return result;
    }

    private RawClass parseClassHeader(String header, String path) {
        ParsedAnnotations pa = parseAnnotations(header);
        String rest = header.substring(Math.min(pa.endOffset(), header.length())).strip();
        if (rest.isEmpty()) {
            return null;
        }
        Matcher m = CLASS_DECL.matcher(rest);
        if (!m.find()) {
            return null;
        }
        String beforeClass = rest.substring(0, rest.indexOf("class"));
        if (Pattern.compile("\\b(interface|enum|record)\\b").matcher(beforeClass).find()) {
            return null;
        }
        RawClass rc = new RawClass();
        rc.name = m.group(1);
        rc.superName = m.group(2);
        rc.path = path;
        for (Ann a : pa.annotations()) {
            switch (a.name()) {
                case "Entity" -> rc.entity = true;
                case "MappedSuperclass" -> rc.mappedSuperclass = true;
                case "Table" -> {
                    String name = attr(a.args(), "name");
                    if (name != null) {
                        rc.tableName = cleanIdentifier(name);
                    }
                }
                default -> {
                }
            }
        }
        if (!rc.entity && !rc.mappedSuperclass) {
            return null;
        }
        return rc;
    }

    private void parseBody(String text, int[] newlines, int from, int to, RawClass rc) {
        int i = from;
        int stmtStart = from;
        while (i < to) {
            char c = text.charAt(i);
            if (c == '"' || c == '\'') {
                i = skipLiteral(text, i);
            } else if (c == '(') {
                i = findMatching(text, i, '(', ')') + 1;
            } else if (c == ';') {
                handleStatement(text, newlines, stmtStart, i, rc);
                i++;
                stmtStart = i;
            } else if (c == '{') {
                String stmt = text.substring(stmtStart, i);
                int close = findMatching(text, i, '{', '}');
                if (topLevelEquals(stmt) >= 0) {
                    i = close + 1; // array / anonymous-class initializer: statement continues until ';'
                } else {
                    i = close + 1; // method, constructor, nested type or init block
                    stmtStart = i;
                }
            } else {
                i++;
            }
        }
    }

    private void handleStatement(String text, int[] newlines, int start, int end, RawClass rc) {
        String stmt = text.substring(start, end);
        if (stmt.isBlank()) {
            return;
        }
        ParsedAnnotations pa = parseAnnotations(stmt);
        String rest = stmt.substring(Math.min(pa.endOffset(), stmt.length()));
        int lead = rest.length() - rest.stripLeading().length();
        String decl = rest.strip();
        if (decl.isEmpty()) {
            return;
        }
        int eq = topLevelEquals(decl);
        String left = (eq >= 0 ? decl.substring(0, eq) : decl).strip();
        if (left.contains("(")) {
            return;
        }
        Matcher m = FIELD_DECL.matcher(left);
        if (!m.find()) {
            return;
        }
        String modifiers = m.group(1);
        String type = m.group(2).trim();
        String name = m.group(3);
        if (modifiers.contains("static") || modifiers.contains("transient")) {
            return;
        }
        for (Ann a : pa.annotations()) {
            if (a.name().equals("Transient")) {
                return;
            }
        }

        RawField f = new RawField();
        f.name = name;
        f.type = type;
        f.filePath = rc.path;
        f.annotations = pa.annotations();
        int nameOffset = start + pa.endOffset() + lead + left.lastIndexOf(name);
        f.line = lineOf(newlines, nameOffset);
        rc.fields.add(f);
    }

    // ------------------------------------------------------------------ low-level scanning

    private ParsedAnnotations parseAnnotations(String stmt) {
        List<Ann> anns = new ArrayList<>();
        int len = stmt.length();
        int i = 0;
        while (true) {
            while (i < len && Character.isWhitespace(stmt.charAt(i))) {
                i++;
            }
            if (i >= len || stmt.charAt(i) != '@' || stmt.startsWith("@interface", i)) {
                break;
            }
            int j = i + 1;
            while (j < len && (Character.isJavaIdentifierPart(stmt.charAt(j)) || stmt.charAt(j) == '.')) {
                j++;
            }
            String name = simpleName(stmt.substring(i + 1, j));
            int k = j;
            while (k < len && Character.isWhitespace(stmt.charAt(k))) {
                k++;
            }
            String args = "";
            if (k < len && stmt.charAt(k) == '(') {
                int close = findMatching(stmt, k, '(', ')');
                args = stmt.substring(k + 1, Math.min(close, len));
                i = Math.min(close + 1, len);
            } else {
                i = j;
            }
            anns.add(new Ann(name, args));
        }
        return new ParsedAnnotations(anns, i);
    }

    /** Index of the first '=' that is not inside parentheses/generics, or -1. */
    private int topLevelEquals(String s) {
        int paren = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\'') {
                i = skipLiteral(s, i) - 1;
            } else if (c == '(') {
                paren++;
            } else if (c == ')') {
                paren--;
            } else if (c == '=' && paren == 0) {
                return i;
            }
        }
        return -1;
    }

    static String stripComments(String s) {
        StringBuilder out = new StringBuilder(s.length());
        int n = s.length();
        int i = 0;
        while (i < n) {
            char c = s.charAt(i);
            char d = i + 1 < n ? s.charAt(i + 1) : '\0';
            if (c == '/' && d == '/') {
                while (i < n && s.charAt(i) != '\n') {
                    out.append(' ');
                    i++;
                }
            } else if (c == '/' && d == '*') {
                out.append("  ");
                i += 2;
                while (i < n && !(s.charAt(i) == '*' && i + 1 < n && s.charAt(i + 1) == '/')) {
                    out.append(s.charAt(i) == '\n' ? '\n' : ' ');
                    i++;
                }
                if (i < n) {
                    out.append("  ");
                    i += 2;
                }
            } else if (c == '"' || c == '\'') {
                int end = skipLiteral(s, i);
                out.append(s, i, end);
                i = end;
            } else {
                out.append(c);
                i++;
            }
        }
        return out.toString();
    }

    /** Returns the index just after the string/char/text-block literal starting at {@code start}. */
    private static int skipLiteral(String s, int start) {
        int n = s.length();
        char quote = s.charAt(start);
        if (quote == '"' && s.startsWith("\"\"\"", start)) {
            int end = s.indexOf("\"\"\"", start + 3);
            return end < 0 ? n : end + 3;
        }
        int i = start + 1;
        while (i < n) {
            char c = s.charAt(i);
            if (c == '\\') {
                i += 2;
            } else if (c == quote) {
                return i + 1;
            } else if (c == '\n') {
                return i; // unterminated literal: stop at end of line
            } else {
                i++;
            }
        }
        return n;
    }

    private static int findMatching(String s, int openIdx, char open, char close) {
        int depth = 0;
        int n = s.length();
        for (int i = openIdx; i < n; i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\'') {
                i = skipLiteral(s, i) - 1;
            } else if (c == open) {
                depth++;
            } else if (c == close) {
                depth--;
                if (depth == 0) {
                    return i;
                }
            }
        }
        return n - 1;
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

    /** 1-based line number of a character offset. */
    private static int lineOf(int[] newlines, int offset) {
        int idx = Arrays.binarySearch(newlines, offset);
        int before = idx >= 0 ? idx : -idx - 1;
        return before + 1;
    }

    // ------------------------------------------------------------------ annotation values & types

    private static String attr(String args, String key) {
        if (args == null) {
            return null;
        }
        Matcher m = Pattern.compile("\\b" + key + "\\s*=\\s*\"([^\"]*)\"").matcher(args);
        return m.find() ? m.group(1) : null;
    }

    private static boolean isFalse(String args, String key) {
        return args != null && Pattern.compile("\\b" + key + "\\s*=\\s*false\\b").matcher(args).find();
    }

    private static boolean isTrue(String args, String key) {
        return args != null && Pattern.compile("\\b" + key + "\\s*=\\s*true\\b").matcher(args).find();
    }

    private static boolean hasNotNull(RawField f) {
        return f.has("NotNull") || f.has("NotBlank") || f.has("NotEmpty");
    }

    private static String relationTarget(String relArgs, String fieldType, boolean collection) {
        if (relArgs != null) {
            Matcher m = Pattern.compile("\\btargetEntity\\s*=\\s*([\\w.]+)\\.class").matcher(relArgs);
            if (m.find()) {
                return simpleName(m.group(1));
            }
        }
        if (collection) {
            Matcher m = Pattern.compile("<\\s*(?:[\\w.]+\\s*,\\s*)?([\\w.]+)\\s*(?:<.*>)?\\s*>").matcher(fieldType);
            if (m.find()) {
                return simpleName(m.group(1));
            }
        }
        return simpleName(stripGenerics(fieldType));
    }

    private static String stripGenerics(String type) {
        int lt = type.indexOf('<');
        return (lt >= 0 ? type.substring(0, lt) : type).replace("[]", "").trim();
    }

    private static String simpleName(String qualified) {
        int dot = qualified.lastIndexOf('.');
        return dot >= 0 ? qualified.substring(dot + 1) : qualified;
    }

    private static boolean isCollectionType(String simple) {
        return Set.of("List", "Set", "Map", "Collection", "SortedSet", "ArrayList", "HashSet").contains(simple);
    }

    private static String cleanIdentifier(String raw) {
        if (raw == null) {
            return null;
        }
        return raw.replace("`", "").replace("\\\"", "").trim();
    }

    static String snake(String camel) {
        if (camel == null) {
            return null;
        }
        return CAMEL.matcher(camel).replaceAll("$1_$2").toLowerCase();
    }

    private static String sqlType(RawField f, String simpleType) {
        Ann column = f.ann("Column");
        String args = column != null ? column.args() : "";
        String length = numberAttr(args, "length");
        switch (simpleType) {
            case "String":
                if (f.has("Lob")) {
                    return "TEXT";
                }
                return "VARCHAR(" + (length != null ? length : "255") + ")";
            case "Long":
            case "long":
                return "BIGINT";
            case "Integer":
            case "int":
                return "INT";
            case "Short":
            case "short":
                return "SMALLINT";
            case "Byte":
            case "byte":
                return f.type.trim().endsWith("[]") ? "BLOB" : "TINYINT";
            case "Boolean":
            case "boolean":
                return "BOOLEAN";
            case "Double":
            case "double":
                return "DOUBLE";
            case "Float":
            case "float":
                return "FLOAT";
            case "BigDecimal": {
                String precision = numberAttr(args, "precision");
                String scale = numberAttr(args, "scale");
                return "DECIMAL(" + (precision != null ? precision : "19") + "," + (scale != null ? scale : "2") + ")";
            }
            case "BigInteger":
                return "NUMERIC";
            case "Instant":
            case "LocalDateTime":
            case "OffsetDateTime":
            case "ZonedDateTime":
            case "Date":
            case "Timestamp":
            case "Calendar":
                return "TIMESTAMP";
            case "LocalDate":
                return "DATE";
            case "LocalTime":
                return "TIME";
            case "UUID":
                return "UUID";
            case "char":
            case "Character":
                return "CHAR(1)";
            default:
                break;
        }
        Ann enumerated = f.ann("Enumerated");
        if (enumerated != null) {
            return enumerated.args().contains("STRING") ? "VARCHAR(" + (length != null ? length : "255") + ")" : "INT";
        }
        return simpleType;
    }

    private static String numberAttr(String args, String key) {
        if (args == null) {
            return null;
        }
        Matcher m = Pattern.compile("\\b" + key + "\\s*=\\s*(\\d+)").matcher(args);
        return m.find() ? m.group(1) : null;
    }
}
