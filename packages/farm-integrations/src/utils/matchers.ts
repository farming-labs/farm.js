export function normalizeMatchers(input?: string | string[]): string[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? input : [input];
}

export function createDocumentNavigationMatchers(...paths: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const matchers: string[] = [];

  for (const path of paths) {
    if (!path) {
      continue;
    }

    const matcher = path.endsWith("(.*)") ? path : `${path}(.*)`;
    if (seen.has(matcher)) {
      continue;
    }

    seen.add(matcher);
    matchers.push(matcher);
  }

  return matchers;
}
