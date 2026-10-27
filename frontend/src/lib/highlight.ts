import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/** VS Code's default dark theme ("Dark+"). */
export const CODE_THEME = 'dark-plus';
export const EDITOR_BACKGROUND = '#1e1e1e';

const LANGUAGE_LOADERS = {
  java: () => import('shiki/langs/java.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
} as const;

type SupportedLang = keyof typeof LANGUAGE_LOADERS;

const EXTENSION_TO_LANG: Record<string, SupportedLang> = {
  java: 'java',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  pom: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  md: 'markdown',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  properties: 'ini',
  toml: 'ini',
  ini: 'ini',
  rs: 'rust',
  go: 'go',
  kt: 'kotlin',
  cs: 'csharp',
};

/** Picks a grammar from the file path (extension first, then well-known file names). */
export function detectLanguage(path: string): SupportedLang | null {
  const name = (path.split('/').pop() || path).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'pom.xml') return 'xml';
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  return EXTENSION_TO_LANG[name.slice(dot + 1)] ?? null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<SupportedLang>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import('shiki/themes/dark-plus.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

export interface HighlightedFile {
  /** One array of coloured tokens per source line. */
  lines: ThemedToken[][];
}

/**
 * Tokenizes the whole file with the VS Code Dark+ theme.
 * Returns `null` for languages we have no grammar for (the caller then renders plain text).
 */
export async function highlightCode(code: string, path: string): Promise<HighlightedFile | null> {
  const lang = detectLanguage(path);
  if (!lang) return null;

  const highlighter = await getHighlighter();
  if (!loadedLangs.has(lang)) {
    await highlighter.loadLanguage(LANGUAGE_LOADERS[lang]());
    loadedLangs.add(lang);
  }

  const lines = highlighter.codeToTokensBase(code, { lang, theme: CODE_THEME });
  return { lines };
}
