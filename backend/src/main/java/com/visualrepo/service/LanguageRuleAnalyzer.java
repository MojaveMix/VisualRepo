package com.visualrepo.service;

import com.visualrepo.dto.ApiDtos.SymbolInfoDto;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class LanguageRuleAnalyzer {

    // Java patterns
    private static final Pattern JAVA_PACKAGE_PATTERN = Pattern.compile("^\\s*package\\s+([\\w.]+)\\s*;");
    private static final Pattern JAVA_IMPORT_PATTERN = Pattern.compile("^\\s*import\\s+(?:static\\s+)?([\\w.*]+)\\s*;");
    private static final Pattern JAVA_TYPE_PATTERN = Pattern.compile(
            "^\\s*(?:public\\s+|protected\\s+|private\\s+|abstract\\s+|final\\s+)*(class|interface|enum|record)\\s+([A-Za-z0-9_]+)");
    private static final Pattern JAVA_METHOD_PATTERN = Pattern.compile(
            "^\\s*(?:public|protected|private)\\s+(?:static\\s+|final\\s+|synchronized\\s+)*(?:[A-Za-z0-9_<>,?\\[\\]]+\\s+)+([a-zA-Z0-9_]+)\\s*\\(.*$");
    private static final Pattern SPRING_MAPPING_PATTERN = Pattern.compile(
            "@(?:RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\\s*\\(\\s*(?:value\\s*=\\s*|path\\s*=\\s*)?\"([^\"]+)\"");

    // TS / JS patterns
    private static final Pattern TS_IMPORT_PATTERN = Pattern.compile(
            "(?:import|export)\\s+(?:type\\s+)?(?:[^'\"]+\\s+from\\s+)?['\"]([^'\"]+)['\"]");
    private static final Pattern TS_SYMBOL_PATTERN = Pattern.compile(
            "^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(function|class|interface|type|const)\\s+([A-Za-z0-9_]+)");
    private static final Pattern API_PATH_LITERAL_PATTERN = Pattern.compile("['\"`](/api/[a-zA-Z0-9_\\-/]+)");

    // Python patterns
    private static final Pattern PY_IMPORT_PATTERN = Pattern.compile(
            "^\\s*(?:from\\s+([\\w.]+)\\s+import\\s+([\\w.*,\\s]+)|import\\s+([\\w.]+))");
    private static final Pattern PY_SYMBOL_PATTERN = Pattern.compile("^(\\s*)(?:async\\s+)?(def|class)\\s+([A-Za-z0-9_]+)");

    public record ParsedChunk(
            String symbolName,
            String chunkType,
            int startLine,
            int endLine,
            String content
    ) {}

    public record AnalyzedFile(
            String path,
            String language,
            String architecturalRole,
            int lineCount,
            String packageName,
            List<String> imports,
            List<SymbolInfoDto> symbols,
            List<ParsedChunk> chunks,
            List<String> exposedApiPaths,
            List<String> calledApiPaths
    ) {}

    public record ResolvedEdge(
            String sourceFilePath,
            String targetFilePath,
            String relationType,
            String targetSymbol
    ) {}

    public AnalyzedFile analyzeFile(String path, String content) {
        String normalized = content.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = normalized.split("\n", -1);
        int lineCount = lines.length;
        String language = detectLanguage(path);
        String role = detectArchitecturalRole(path, normalized, language);

        List<String> imports = new ArrayList<>();
        List<SymbolInfoDto> symbols = new ArrayList<>();
        List<ParsedChunk> chunks = new ArrayList<>();
        List<String> exposedApis = new ArrayList<>();
        List<String> calledApis = new ArrayList<>();
        String packageName = "";

        if ("Java".equals(language)) {
            packageName = parseJavaFile(path, lines, imports, symbols, chunks, exposedApis);
        } else if ("TypeScript".equals(language) || "JavaScript".equals(language)) {
            parseTsJsFile(path, lines, imports, symbols, chunks, calledApis);
        } else if ("Python".equals(language)) {
            parsePythonFile(path, lines, imports, symbols, chunks);
        } else {
            parseGenericFile(path, lines, symbols, chunks);
        }

        if (chunks.isEmpty()) {
            chunks.add(new ParsedChunk(
                    extractSimpleFilename(path),
                    "FILE",
                    1,
                    lineCount,
                    normalized
            ));
        }

        return new AnalyzedFile(
                path,
                language,
                role,
                lineCount,
                packageName,
                imports,
                symbols,
                chunks,
                exposedApis,
                calledApis
        );
    }

    private String parseJavaFile(
            String path,
            String[] lines,
            List<String> imports,
            List<SymbolInfoDto> symbols,
            List<ParsedChunk> chunks,
            List<String> exposedApis
    ) {
        String packageName = "";
        int lastImportLine = 1;

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            int lineNum = i + 1;

            Matcher pkgMatcher = JAVA_PACKAGE_PATTERN.matcher(line);
            if (pkgMatcher.find()) {
                packageName = pkgMatcher.group(1);
            }

            Matcher impMatcher = JAVA_IMPORT_PATTERN.matcher(line);
            if (impMatcher.find()) {
                imports.add(impMatcher.group(1));
                lastImportLine = lineNum;
            }

            Matcher apiMatcher = SPRING_MAPPING_PATTERN.matcher(line);
            while (apiMatcher.find()) {
                exposedApis.add(apiMatcher.group(1));
            }

            Matcher typeMatcher = JAVA_TYPE_PATTERN.matcher(line);
            if (typeMatcher.find()) {
                String kind = typeMatcher.group(1).toUpperCase(Locale.ROOT);
                String name = typeMatcher.group(2);
                int startLine = findAnnotationStart(lines, i);
                int endLine = findBraceBlockEnd(lines, i);
                symbols.add(new SymbolInfoDto(name, kind, startLine, endLine));

                // If class is reasonably sized, also add a class-header chunk
                int headerEnd = Math.min(endLine, startLine + 30);
                chunks.add(new ParsedChunk(
                        name + " (declaration)",
                        kind,
                        startLine,
                        headerEnd,
                        sliceLines(lines, startLine, headerEnd)
                ));
                continue;
            }

            Matcher methodMatcher = JAVA_METHOD_PATTERN.matcher(line);
            if (methodMatcher.find()) {
                String methodName = methodMatcher.group(1);
                if (!Set.of("if", "for", "while", "switch", "catch", "return", "new").contains(methodName)) {
                    int startLine = findAnnotationStart(lines, i);
                    int endLine = findBraceBlockEnd(lines, i);
                    symbols.add(new SymbolInfoDto(methodName + "()", "METHOD", startLine, endLine));
                    chunks.add(new ParsedChunk(
                            methodName + "()",
                            "METHOD",
                            startLine,
                            endLine,
                            sliceLines(lines, startLine, endLine)
                    ));
                }
            }
        }

        if (lastImportLine > 1) {
            chunks.add(0, new ParsedChunk(
                    extractSimpleFilename(path) + " (imports & package)",
                    "FILE_HEADER",
                    1,
                    lastImportLine,
                    sliceLines(lines, 1, lastImportLine)
            ));
        }

        return packageName;
    }

    private void parseTsJsFile(
            String path,
            String[] lines,
            List<String> imports,
            List<SymbolInfoDto> symbols,
            List<ParsedChunk> chunks,
            List<String> calledApis
    ) {
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            int lineNum = i + 1;

            Matcher impMatcher = TS_IMPORT_PATTERN.matcher(line);
            while (impMatcher.find()) {
                imports.add(impMatcher.group(1));
            }

            Matcher apiMatcher = API_PATH_LITERAL_PATTERN.matcher(line);
            while (apiMatcher.find()) {
                calledApis.add(apiMatcher.group(1));
            }

            Matcher symMatcher = TS_SYMBOL_PATTERN.matcher(line);
            if (symMatcher.find()) {
                String rawKind = symMatcher.group(1).toUpperCase(Locale.ROOT);
                String name = symMatcher.group(2);
                int endLine = findBraceBlockEnd(lines, i);
                if (endLine <= lineNum && line.contains("(")) {
                    endLine = Math.min(lines.length, lineNum + 15);
                }
                String kind = (Character.isUpperCase(name.charAt(0)) && ("FUNCTION".equals(rawKind) || "CONST".equals(rawKind)))
                        ? "COMPONENT"
                        : rawKind;
                symbols.add(new SymbolInfoDto(name, kind, lineNum, endLine));
                chunks.add(new ParsedChunk(
                        name,
                        kind,
                        lineNum,
                        endLine,
                        sliceLines(lines, lineNum, endLine)
                ));
            }
        }

        if (chunks.isEmpty()) {
            chunkByFixedWindows(path, lines, chunks, 45);
        }
    }

    private void parsePythonFile(
            String path,
            String[] lines,
            List<String> imports,
            List<SymbolInfoDto> symbols,
            List<ParsedChunk> chunks
    ) {
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            int lineNum = i + 1;

            Matcher impMatcher = PY_IMPORT_PATTERN.matcher(line);
            if (impMatcher.find()) {
                String mod = impMatcher.group(1) != null ? impMatcher.group(1) : impMatcher.group(3);
                if (mod != null) {
                    imports.add(mod.trim());
                }
            }

            Matcher symMatcher = PY_SYMBOL_PATTERN.matcher(line);
            if (symMatcher.find()) {
                int indent = symMatcher.group(1).length();
                String kind = "class".equals(symMatcher.group(2)) ? "CLASS" : "FUNCTION";
                String name = symMatcher.group(3);
                int endLine = findPythonBlockEnd(lines, i, indent);
                symbols.add(new SymbolInfoDto(name, kind, lineNum, endLine));
                chunks.add(new ParsedChunk(
                        name,
                        kind,
                        lineNum,
                        endLine,
                        sliceLines(lines, lineNum, endLine)
                ));
            }
        }

        if (chunks.isEmpty()) {
            chunkByFixedWindows(path, lines, chunks, 45);
        }
    }

    private void parseGenericFile(
            String path,
            String[] lines,
            List<SymbolInfoDto> symbols,
            List<ParsedChunk> chunks
    ) {
        chunkByFixedWindows(path, lines, chunks, 50);
        for (ParsedChunk chunk : chunks) {
            symbols.add(new SymbolInfoDto(chunk.symbolName(), chunk.chunkType(), chunk.startLine(), chunk.endLine()));
        }
    }

    private void chunkByFixedWindows(String path, String[] lines, List<ParsedChunk> chunks, int windowSize) {
        String baseName = extractSimpleFilename(path);
        int total = lines.length;
        for (int start = 1; start <= total; start += windowSize) {
            int end = Math.min(total, start + windowSize - 1);
            String label = total <= windowSize ? baseName : baseName + " (L" + start + "-L" + end + ")";
            chunks.add(new ParsedChunk(
                    label,
                    "SECTION",
                    start,
                    end,
                    sliceLines(lines, start, end)
            ));
        }
    }

    public List<ResolvedEdge> resolveDependencyEdges(List<AnalyzedFile> analyzedFiles, Map<String, String> fileContentsByPath) {
        List<ResolvedEdge> edges = new ArrayList<>();
        Set<String> seenEdgeKeys = new HashSet<>();

        Map<String, AnalyzedFile> byPath = new HashMap<>();
        Map<String, String> javaClassFqnToPath = new HashMap<>();
        Map<String, List<AnalyzedFile>> javaPackageToFiles = new HashMap<>();

        for (AnalyzedFile af : analyzedFiles) {
            byPath.put(af.path(), af);
            if ("Java".equals(af.language())) {
                String simpleClass = stripExtension(extractSimpleFilename(af.path()));
                if (!af.packageName().isBlank()) {
                    javaClassFqnToPath.put(af.packageName() + "." + simpleClass, af.path());
                    javaPackageToFiles.computeIfAbsent(af.packageName(), k -> new ArrayList<>()).add(af);
                }
                javaClassFqnToPath.put(simpleClass, af.path());
            }
        }

        for (AnalyzedFile source : analyzedFiles) {
            // 1. Java imports + same-package references
            if ("Java".equals(source.language())) {
                for (String imp : source.imports()) {
                    String targetPath = javaClassFqnToPath.get(imp);
                    if (targetPath != null && !targetPath.equals(source.path())) {
                        addUniqueEdge(edges, seenEdgeKeys, source.path(), targetPath, "IMPORT", extractLastSegment(imp, '.'));
                    }
                }
                // Check same-package sibling references in content
                if (!source.packageName().isBlank()) {
                    String content = fileContentsByPath.getOrDefault(source.path(), "");
                    for (AnalyzedFile sibling : javaPackageToFiles.getOrDefault(source.packageName(), List.of())) {
                        if (!sibling.path().equals(source.path())) {
                            String siblingClass = stripExtension(extractSimpleFilename(sibling.path()));
                            if (content.contains(siblingClass)) {
                                addUniqueEdge(edges, seenEdgeKeys, source.path(), sibling.path(), "INJECTION", siblingClass);
                            }
                        }
                    }
                }
            }

            // 2. TypeScript / JavaScript relative and alias imports
            if ("TypeScript".equals(source.language()) || "JavaScript".equals(source.language())) {
                for (String imp : source.imports()) {
                    String resolved = resolveRelativeImport(source.path(), imp, byPath.keySet());
                    if (resolved != null && !resolved.equals(source.path())) {
                        addUniqueEdge(edges, seenEdgeKeys, source.path(), resolved, "IMPORT", extractSimpleFilename(resolved));
                    }
                }
            }

            // 3. Python module imports
            if ("Python".equals(source.language())) {
                for (String imp : source.imports()) {
                    String pathCandidate = imp.replace('.', '/') + ".py";
                    for (String candidatePath : byPath.keySet()) {
                        if (candidatePath.endsWith(pathCandidate) && !candidatePath.equals(source.path())) {
                            addUniqueEdge(edges, seenEdgeKeys, source.path(), candidatePath, "IMPORT", imp);
                        }
                    }
                }
            }

            // 4. Cross-stack Frontend -> Backend REST API path matching
            if (!source.calledApiPaths().isEmpty()) {
                for (String calledApi : source.calledApiPaths()) {
                    for (AnalyzedFile candidateController : analyzedFiles) {
                        if (candidateController.path().equals(source.path())) {
                            continue;
                        }
                        for (String exposed : candidateController.exposedApiPaths()) {
                            if (!exposed.isBlank() && (calledApi.startsWith(exposed) || exposed.startsWith(calledApi))) {
                                addUniqueEdge(edges, seenEdgeKeys, source.path(), candidateController.path(), "API_CALL", calledApi);
                            }
                        }
                    }
                }
            }
        }

        return edges;
    }

    private void addUniqueEdge(List<ResolvedEdge> edges, Set<String> seen, String src, String tgt, String type, String sym) {
        String key = src + "->" + tgt;
        if (seen.add(key)) {
            edges.add(new ResolvedEdge(src, tgt, type, sym));
        }
    }

    private String resolveRelativeImport(String sourcePath, String rawImport, Set<String> allPaths) {
        if (!rawImport.startsWith(".")) {
            return null;
        }
        String dir = sourcePath.contains("/") ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : "";
        String combined = dir.isEmpty() ? rawImport : dir + "/" + rawImport;
        String[] segments = combined.split("/");
        Deque<String> stack = new ArrayDeque<>();
        for (String seg : segments) {
            if (seg.isEmpty() || ".".equals(seg)) {
                continue;
            }
            if ("..".equals(seg)) {
                if (!stack.isEmpty()) {
                    stack.removeLast();
                }
            } else {
                stack.addLast(seg);
            }
        }
        String normalizedBase = String.join("/", stack);
        List<String> candidates = List.of(
                normalizedBase,
                normalizedBase + ".ts",
                normalizedBase + ".tsx",
                normalizedBase + ".js",
                normalizedBase + ".jsx",
                normalizedBase + "/index.ts",
                normalizedBase + "/index.tsx",
                normalizedBase + "/index.js"
        );
        for (String c : candidates) {
            if (allPaths.contains(c)) {
                return c;
            }
        }
        return null;
    }

    private int findAnnotationStart(String[] lines, int declarationIdx) {
        int idx = declarationIdx;
        while (idx > 0) {
            String prev = lines[idx - 1].trim();
            if (prev.startsWith("@")) {
                idx--;
            } else {
                break;
            }
        }
        return idx + 1;
    }

    private int findBraceBlockEnd(String[] lines, int startIdx) {
        int depth = 0;
        boolean opened = false;
        for (int i = startIdx; i < lines.length; i++) {
            String line = lines[i];
            for (int c = 0; c < line.length(); c++) {
                char ch = line.charAt(c);
                if (ch == '{') {
                    depth++;
                    opened = true;
                } else if (ch == '}') {
                    depth--;
                    if (opened && depth <= 0) {
                        return i + 1;
                    }
                }
            }
            if (!opened && i > startIdx + 3 && line.trim().endsWith(";")) {
                return i + 1;
            }
        }
        return Math.min(lines.length, startIdx + 25);
    }

    private int findPythonBlockEnd(String[] lines, int startIdx, int baseIndent) {
        int lastNonEmpty = startIdx + 1;
        for (int i = startIdx + 1; i < lines.length; i++) {
            String line = lines[i];
            if (line.trim().isEmpty() || line.trim().startsWith("#")) {
                continue;
            }
            int currentIndent = 0;
            while (currentIndent < line.length() && Character.isWhitespace(line.charAt(currentIndent))) {
                currentIndent++;
            }
            if (currentIndent <= baseIndent) {
                return lastNonEmpty;
            }
            lastNonEmpty = i + 1;
        }
        return lastNonEmpty;
    }

    private String sliceLines(String[] lines, int startLine, int endLine) {
        int s = Math.max(1, startLine);
        int e = Math.min(lines.length, Math.max(s, endLine));
        StringBuilder sb = new StringBuilder();
        for (int i = s - 1; i < e; i++) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(lines[i]);
        }
        return sb.toString();
    }

    public String detectLanguage(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".java")) return "Java";
        if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "TypeScript";
        if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "JavaScript";
        if (lower.endsWith(".py")) return "Python";
        if (lower.endsWith(".go")) return "Go";
        if (lower.endsWith(".rs")) return "Rust";
        if (lower.endsWith(".sql")) return "SQL";
        if (lower.endsWith(".md")) return "Markdown";
        if (lower.endsWith(".yml") || lower.endsWith(".yaml") || lower.endsWith(".json") || lower.endsWith(".xml")) {
            return "Configuration";
        }
        return "Source";
    }

    public String detectArchitecturalRole(String path, String content, String language) {
        String lowerPath = "/" + path.toLowerCase(Locale.ROOT);
        String fileName = extractSimpleFilename(lowerPath);

        // 1. Test files first so tests inside /service/ or /controller/ are not misclassified as production tiers
        if (lowerPath.contains("/test/") || lowerPath.contains("/tests/") || lowerPath.contains("/__tests__/")
                || fileName.endsWith("test.java") || fileName.endsWith("tests.java")
                || fileName.startsWith("test_") || fileName.endsWith("_test.py") || fileName.endsWith("_test.go")
                || fileName.contains(".spec.") || fileName.contains(".test.")) {
            return "TEST";
        }

        // 2. Configuration, build & documentation files
        if (lowerPath.contains("/config/") || lowerPath.contains("/configs/") || lowerPath.contains("/settings/")
                || fileName.endsWith("config.java") || fileName.equals("config.py") || fileName.equals("settings.py")
                || fileName.contains(".config.") || fileName.equals("vite.config.ts")
                || content.contains("@Configuration") || "Configuration".equals(language) || "Markdown".equals(language)) {
            return "CONFIG";
        }

        // 3. Frontend UI components & views
        boolean isFrontendPath = lowerPath.contains("/frontend/") || lowerPath.contains("/client/")
                || lowerPath.contains("/web/") || lowerPath.contains("/ui/");
        if (lowerPath.contains("/components/") || lowerPath.contains("/pages/") || lowerPath.contains("/views/")
                || lowerPath.contains("/screens/") || lowerPath.contains("/layouts/")
                || lowerPath.endsWith(".tsx") || lowerPath.endsWith(".jsx")
                || lowerPath.endsWith(".vue") || lowerPath.endsWith(".svelte")) {
            return "UI_COMPONENT";
        }

        // 4. Frontend API clients & HTTP integration bridges
        if ((isFrontendPath && (lowerPath.contains("/api/") || lowerPath.contains("/services/") || fileName.contains("api") || fileName.contains("client")))
                || fileName.endsWith("api.ts") || fileName.endsWith("api.js")
                || fileName.endsWith("client.ts") || fileName.endsWith("client.js")
                || (("TypeScript".equals(language) || "JavaScript".equals(language))
                    && (content.contains("fetch(") || content.contains("axios.")))) {
            return "API_CLIENT";
        }

        // 5. Domain models, database entities, schemas & DTOs
        if (lowerPath.contains("/model/") || lowerPath.contains("/models/")
                || lowerPath.contains("/entity/") || lowerPath.contains("/entities/")
                || lowerPath.contains("/domain/") || lowerPath.contains("/schema/") || lowerPath.contains("/schemas/")
                || lowerPath.contains("/dto/") || lowerPath.contains("/dtos/") || lowerPath.contains("/types/")
                || "SQL".equals(language) || fileName.endsWith(".prisma")
                || content.contains("@Entity") || content.contains("@Table")
                || content.contains("@dataclass") || content.contains("(BaseModel)")) {
            return "MODEL";
        }

        // 6. Data access, repositories, vector stores & DAOs
        if (lowerPath.contains("/repository/") || lowerPath.contains("/repositories/")
                || lowerPath.contains("/dao/") || lowerPath.contains("/store/") || lowerPath.contains("/stores/")
                || lowerPath.contains("/db/") || lowerPath.contains("/database/")
                || fileName.endsWith("repository.java") || fileName.endsWith("store.py") || fileName.endsWith("vectorstore.py")
                || content.contains("@Repository") || content.contains("extends JpaRepository")
                || content.contains("CREATE TABLE") || content.contains("get_or_create_collection")) {
            return "REPOSITORY";
        }

        // 7. API Controllers, routers & HTTP entrypoints
        if (lowerPath.contains("/controller/") || lowerPath.contains("/controllers/")
                || lowerPath.contains("/routes/") || lowerPath.contains("/routers/") || lowerPath.contains("/endpoints/")
                || fileName.endsWith("controller.java") || fileName.contains("router")
                || fileName.equals("app.py") || fileName.equals("main.py") || fileName.equals("server.py")
                || fileName.equals("server.ts") || fileName.equals("server.js")
                || content.contains("@RestController") || content.contains("@Controller")
                || content.contains("FastAPI(") || content.contains("APIRouter(") || content.contains("Flask(")) {
            return "CONTROLLER";
        }

        // 8. Business services, orchestrators & domain pipelines
        if (lowerPath.contains("/service/") || lowerPath.contains("/services/")
                || lowerPath.contains("/usecase/") || lowerPath.contains("/usecases/")
                || lowerPath.contains("/rag/") || lowerPath.contains("/pipeline/")
                || fileName.endsWith("service.java") || fileName.endsWith("_service.py")
                || content.contains("@Service") || content.contains("@Component")) {
            return "SERVICE";
        }

        // 9. Frontend supporting libraries/hooks stay with Frontend API/Client layer
        if (isFrontendPath) {
            return "API_CLIENT";
        }

        return "MODULE";
    }

    private String extractSimpleFilename(String path) {
        return path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
    }

    private String stripExtension(String filename) {
        return filename.contains(".") ? filename.substring(0, filename.lastIndexOf('.')) : filename;
    }

    private String extractLastSegment(String text, char sep) {
        int idx = text.lastIndexOf(sep);
        return idx >= 0 ? text.substring(idx + 1) : text;
    }
}
