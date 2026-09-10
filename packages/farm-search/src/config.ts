export interface SearchOptions {
  /** URL patterns to index. Patterns are matched without Farm's basePath. */
  include?: string[];
  /** URL patterns to omit. Patterns are matched without Farm's basePath. */
  exclude?: string[];
  /** Static bundle directory, relative to Farm's basePath. */
  output?: string;
  /** Restrict indexed document content to one CSS selector. */
  rootSelector?: string;
  /** Additional CSS selectors Pagefind should ignore. */
  excludeSelectors?: string[];
  /** Force every page into one ISO 639-1 language index. */
  language?: string;
  /** Characters Pagefind should preserve inside indexed words. */
  includeCharacters?: string;
  /** Keep index.html in result URLs. */
  keepIndexUrl?: boolean;
  /** Number of words in generated result excerpts. */
  excerptLength?: number;
  /** Query parameter used by Pagefind's optional result highlighting. */
  highlightParam?: string | false;
  /** Print Pagefind's detailed build diagnostics. */
  verbose?: boolean;
}

export interface ResolvedSearchOptions {
  include: string[];
  exclude: string[];
  output: string;
  rootSelector?: string;
  excludeSelectors: string[];
  language?: string;
  includeCharacters?: string;
  keepIndexUrl: boolean;
  excerptLength: number;
  highlightParam?: string;
  verbose: boolean;
}

const DEFAULT_OUTPUT = "_farm/search";

export function resolveSearchOptions(options: SearchOptions = {}): ResolvedSearchOptions {
  if ("enabled" in options) {
    throw new TypeError(
      "Search does not accept enabled; remove search() from plugins to disable it",
    );
  }

  return {
    include: normalizePatterns(options.include ?? ["/**"], "include"),
    exclude: normalizePatterns(options.exclude ?? [], "exclude"),
    output: normalizeOutput(options.output ?? DEFAULT_OUTPUT),
    rootSelector: normalizeOptionalString(options.rootSelector, "rootSelector"),
    excludeSelectors: normalizeStrings(options.excludeSelectors ?? [], "excludeSelectors"),
    language: normalizeLanguage(options.language),
    includeCharacters: normalizeOptionalString(options.includeCharacters, "includeCharacters"),
    keepIndexUrl: normalizeBoolean(options.keepIndexUrl, "keepIndexUrl") ?? false,
    excerptLength: normalizeExcerptLength(options.excerptLength ?? 30),
    highlightParam:
      options.highlightParam === false
        ? undefined
        : normalizeOptionalString(options.highlightParam, "highlightParam"),
    verbose: normalizeBoolean(options.verbose, "verbose") ?? false,
  };
}

function normalizePatterns(values: string[], label: string): string[] {
  const patterns = normalizeStrings(values, label).map((value) => {
    const normalized = value === "/" ? "/" : `/${value.replace(/^\/+|\/+$/g, "")}`;
    if (normalized.includes("\\")) {
      throw new TypeError(`Search ${label} patterns must use URL separators`);
    }
    return normalized;
  });
  return [...new Set(patterns)];
}

function normalizeStrings(values: string[], label: string): string[] {
  if (!Array.isArray(values)) throw new TypeError(`Search ${label} must be an array of strings`);
  return values.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Search ${label} must contain non-empty strings`);
    }
    return value.trim();
  });
}

function normalizeOptionalString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Search ${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOutput(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("Search output must be a non-empty relative URL path");
  }
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    segments.some((segment) => segment === "." || segment === ".." || !segment)
  ) {
    throw new TypeError("Search output must stay inside the public output directory");
  }
  return normalized;
}

function normalizeLanguage(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value, "language")?.toLowerCase();
  if (normalized && !/^[a-z]{2}$/.test(normalized)) {
    throw new TypeError("Search language must be a two-letter ISO 639-1 code");
  }
  return normalized;
}

function normalizeExcerptLength(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new TypeError("Search excerptLength must be an integer from 1 to 1000");
  }
  return value;
}

function normalizeBoolean(value: boolean | undefined, label: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`Search ${label} must be a boolean`);
  }
  return value;
}
