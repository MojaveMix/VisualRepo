const REPO_PATTERN = /^(?:https?:\/\/(?:www\.)?github\.com\/)?[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/i;

/** Accepts `owner/repo` or a `https://github.com/owner/repo` URL. */
export function isValidRepoInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // allow deeper GitHub URLs such as /tree/main by testing only the first two path segments
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (urlMatch) return true;
  return REPO_PATTERN.test(trimmed);
}

export const EXAMPLE_REPOS = [
  { value: 'demo/order-payment-platform', label: 'Built-in demo (instant)' },
  { value: 'spring-projects/spring-petclinic', label: 'spring-petclinic (Java)' },
  { value: 'pallets/flask', label: 'flask (Python)' },
];
