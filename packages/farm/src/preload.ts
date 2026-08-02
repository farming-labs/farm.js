export type FarmPreloadMode = "warn" | "enforce";

export interface FarmPreloadUserConfig {
  /** Report excess hints or remove the lower-priority hints. @default "enforce" */
  mode?: FarmPreloadMode;
  /** Maximum image preload hints per document. @default 1 */
  maxImages?: number;
  /** Maximum font preload hints per document. @default 2 */
  maxFonts?: number;
}

export interface ResolvedFarmPreloadConfig {
  mode: FarmPreloadMode;
  maxImages: number;
  maxFonts: number;
}

export interface FarmPerformanceConfig {
  preload?: FarmPreloadUserConfig;
}

export interface ResolvedFarmPerformanceConfig {
  preload: ResolvedFarmPreloadConfig;
}

export type FarmPreloadKind = "image" | "font";

export interface FarmPreloadBudgetWarning {
  kind: FarmPreloadKind;
  count: number;
  budget: number;
  removed: number;
}

export interface FarmManagedPreloads {
  value: string;
  warnings: FarmPreloadBudgetWarning[];
}

export interface FarmManagedDocumentPreloads {
  html: string;
  linkHeader: string;
  warnings: FarmPreloadBudgetWarning[];
}

const DEFAULT_PRELOAD_CONFIG: ResolvedFarmPreloadConfig = {
  mode: "enforce",
  maxImages: 1,
  maxFonts: 2,
};

const reportedWarnings = new Map<string, number>();
const PRELOAD_WARNING_TTL_MS = 60_000;
const MAX_REPORTED_PRELOAD_WARNINGS = 256;

export function resolveFarmPerformanceConfig(
  config: FarmPerformanceConfig | undefined,
): ResolvedFarmPerformanceConfig {
  return {
    preload: {
      mode: config?.preload?.mode === "warn" ? "warn" : "enforce",
      maxImages: normalizeBudget(config?.preload?.maxImages, DEFAULT_PRELOAD_CONFIG.maxImages),
      maxFonts: normalizeBudget(config?.preload?.maxFonts, DEFAULT_PRELOAD_CONFIG.maxFonts),
    },
  };
}

/**
 * Apply image and font budgets to HTML preload elements. High-priority image
 * hints are retained before ordinary hints, making an explicitly preloaded LCP
 * image the winner when a document contains too many React-generated hints.
 */
export function manageFarmHtmlPreloads(
  html: string,
  config: ResolvedFarmPreloadConfig,
): FarmManagedPreloads {
  const elements = findHtmlLinkElements(html);
  const candidates = elements.flatMap((element, index) => {
    const kind = getHtmlPreloadKind(element.value);
    return kind
      ? [
          {
            index,
            kind,
            highPriority:
              readHtmlAttribute(element.value, "fetchpriority")?.toLowerCase() === "high",
          },
        ]
      : [];
  });

  const budget = selectPreloadsWithinBudget(candidates, config);
  if (config.mode === "warn" || budget.removed.size === 0) {
    return { value: html, warnings: budget.warnings };
  }

  return {
    value: removeHtmlLinkElements(html, elements, budget.removed),
    warnings: budget.warnings,
  };
}

/** Apply the same budgets to HTTP Link preload hints, including Farm fonts. */
export function manageFarmLinkHeaderPreloads(
  value: string,
  config: ResolvedFarmPreloadConfig,
): FarmManagedPreloads {
  if (!value) return { value, warnings: [] };

  const links = splitLinkHeader(value);
  const candidates = links.flatMap((link, index) => {
    const kind = getLinkHeaderPreloadKind(link);
    return kind
      ? [
          {
            index,
            kind,
            highPriority: getLinkHeaderParameter(link, "fetchpriority")?.toLowerCase() === "high",
          },
        ]
      : [];
  });
  const budget = selectPreloadsWithinBudget(candidates, config);

  return {
    value:
      config.mode === "enforce"
        ? links.filter((_, index) => !budget.removed.has(index)).join(", ")
        : value,
    warnings: budget.warnings,
  };
}

/** Apply a single document budget across HTML and HTTP Link header hints. */
export function manageFarmDocumentPreloads(
  html: string,
  linkHeader: string,
  config: ResolvedFarmPreloadConfig,
): FarmManagedDocumentPreloads {
  const elements = findHtmlLinkElements(html);
  const links = linkHeader ? splitLinkHeader(linkHeader) : [];
  const headerOffset = elements.length;
  const candidates: PreloadCandidate[] = [];

  for (const [index, element] of elements.entries()) {
    const kind = getHtmlPreloadKind(element.value);
    if (!kind) continue;
    candidates.push({
      index,
      kind,
      highPriority: readHtmlAttribute(element.value, "fetchpriority")?.toLowerCase() === "high",
    });
  }
  for (const [index, link] of links.entries()) {
    const kind = getLinkHeaderPreloadKind(link);
    if (!kind) continue;
    candidates.push({
      index: headerOffset + index,
      kind,
      highPriority: getLinkHeaderParameter(link, "fetchpriority")?.toLowerCase() === "high",
    });
  }

  const budget = selectPreloadsWithinBudget(candidates, config);
  if (config.mode === "warn" || budget.removed.size === 0) {
    return { html, linkHeader, warnings: budget.warnings };
  }

  return {
    html: removeHtmlLinkElements(html, elements, budget.removed),
    linkHeader: links.filter((_, index) => !budget.removed.has(headerOffset + index)).join(", "),
    warnings: budget.warnings,
  };
}

/** Rate-limit identical route-and-budget warnings within a server process. */
export function reportFarmPreloadWarnings(
  warnings: FarmPreloadBudgetWarning[],
  context = "the rendered document",
): void {
  const now = Date.now();
  for (const [key, reportedAt] of reportedWarnings) {
    if (now - reportedAt >= PRELOAD_WARNING_TTL_MS) reportedWarnings.delete(key);
  }

  for (const warning of warnings) {
    const key = `${context}:${warning.kind}:${warning.count}:${warning.budget}:${warning.removed}`;
    const reportedAt = reportedWarnings.get(key);
    if (reportedAt !== undefined && now - reportedAt < PRELOAD_WARNING_TTL_MS) continue;
    reportedWarnings.set(key, now);
    while (reportedWarnings.size > MAX_REPORTED_PRELOAD_WARNINGS) {
      const oldest = reportedWarnings.keys().next().value;
      if (oldest === undefined) break;
      reportedWarnings.delete(oldest);
    }

    const action = warning.removed > 0 ? ` Removed ${warning.removed} lower-priority hint(s).` : "";
    const recommendation =
      warning.kind === "image"
        ? ' Mark only the LCP image with `preload` or `fetchPriority="high"`.'
        : " Set `preload: false` on fonts that are not required above the fold.";
    console.warn(
      `[Farm.js] ${context} emitted ${warning.count} ${warning.kind} preload hints ` +
        `(budget: ${warning.budget}).${action}${recommendation}`,
    );
  }
}

export function clearReportedFarmPreloadWarnings(): void {
  reportedWarnings.clear();
}

interface PreloadCandidate {
  index: number;
  kind: FarmPreloadKind;
  highPriority: boolean;
}

function selectPreloadsWithinBudget(
  candidates: PreloadCandidate[],
  config: ResolvedFarmPreloadConfig,
): { removed: Set<number>; warnings: FarmPreloadBudgetWarning[] } {
  const removed = new Set<number>();
  const warnings: FarmPreloadBudgetWarning[] = [];

  for (const kind of ["image", "font"] as const) {
    const matching = candidates.filter((candidate) => candidate.kind === kind);
    const limit = kind === "image" ? config.maxImages : config.maxFonts;
    if (matching.length <= limit) continue;

    const retained = new Set(
      [...matching]
        .sort(
          (left, right) =>
            Number(right.highPriority) - Number(left.highPriority) || left.index - right.index,
        )
        .slice(0, limit)
        .map((candidate) => candidate.index),
    );

    if (config.mode === "enforce") {
      for (const candidate of matching) {
        if (!retained.has(candidate.index)) removed.add(candidate.index);
      }
    }

    warnings.push({
      kind,
      count: matching.length,
      budget: limit,
      removed: config.mode === "enforce" ? matching.length - retained.size : 0,
    });
  }

  return { removed, warnings };
}

function getHtmlPreloadKind(link: string): FarmPreloadKind | undefined {
  const rel = readHtmlAttribute(link, "rel")?.toLowerCase().split(/\s+/) || [];
  if (!rel.includes("preload")) return undefined;
  return normalizePreloadKind(readHtmlAttribute(link, "as"));
}

function getLinkHeaderPreloadKind(link: string): FarmPreloadKind | undefined {
  const relations = getLinkHeaderParameter(link, "rel")?.toLowerCase().split(/\s+/) ?? [];
  if (!relations.includes("preload")) return undefined;
  return normalizePreloadKind(getLinkHeaderParameter(link, "as"));
}

function getLinkHeaderParameter(link: string, name: string): string | undefined {
  const uriEnd = link.indexOf(">");
  if (uriEnd === -1) return undefined;

  for (const parameter of splitLinkParameters(link.slice(uriEnd + 1))) {
    const separator = parameter.indexOf("=");
    const parameterName = (separator === -1 ? parameter : parameter.slice(0, separator))
      .trim()
      .toLowerCase();
    if (parameterName !== name.toLowerCase() || separator === -1) continue;
    const rawValue = parameter.slice(separator + 1).trim();
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      return rawValue.slice(1, -1).replace(/\\([\\"])/g, "$1");
    }
    return rawValue;
  }
  return undefined;
}

function splitLinkParameters(value: string): string[] {
  const parameters: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && !isEscaped(value, index)) quoted = !quoted;
    else if (character === ";" && !quoted) {
      const parameter = value.slice(start, index).trim();
      if (parameter) parameters.push(parameter);
      start = index + 1;
    }
  }
  const parameter = value.slice(start).trim();
  if (parameter) parameters.push(parameter);
  return parameters;
}

function normalizePreloadKind(value: string | undefined): FarmPreloadKind | undefined {
  const normalized = value?.toLowerCase();
  return normalized === "image" || normalized === "font" ? normalized : undefined;
}

function readHtmlAttribute(element: string, name: string): string | undefined {
  const match = element.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

interface HtmlLinkElement {
  start: number;
  end: number;
  value: string;
}

function findHtmlLinkElements(html: string): HtmlLinkElement[] {
  const elements: HtmlLinkElement[] = [];
  const lowerHtml = html.toLowerCase();
  let cursor = 0;

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start === -1) break;

    if (lowerHtml.startsWith("<!--", start)) {
      const commentEnd = lowerHtml.indexOf("-->", start + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const rawText = lowerHtml
      .slice(start)
      .match(/^<(script|style|template|textarea|title|noscript|svg)(?=[\s/>])/);
    if (rawText?.[1]) {
      const openingEnd = findHtmlTagEnd(html, start);
      if (openingEnd === -1) break;
      const closingStart = findHtmlClosingTag(lowerHtml, rawText[1], openingEnd);
      if (closingStart === -1) {
        cursor = html.length;
        continue;
      }
      const closingEnd = findHtmlTagEnd(html, closingStart);
      cursor = closingEnd === -1 ? html.length : closingEnd;
      continue;
    }

    if (/^<link(?=[\s/>])/i.test(html.slice(start))) {
      const end = findHtmlTagEnd(html, start);
      if (end === -1) break;
      elements.push({ start, end, value: html.slice(start, end) });
      cursor = end;
      continue;
    }

    if (/^<\/?[A-Za-z][\w:-]*(?=[\s/>])/.test(html.slice(start))) {
      const end = findHtmlTagEnd(html, start);
      cursor = end === -1 ? html.length : end;
      continue;
    }

    cursor = start + 1;
  }

  return elements;
}

function findHtmlClosingTag(html: string, tagName: string, start: number): number {
  const prefix = `</${tagName}`;
  let candidate = html.indexOf(prefix, start);
  while (candidate !== -1) {
    const boundary = html[candidate + prefix.length];
    if (boundary === ">" || boundary === "/" || /\s/.test(boundary ?? "")) return candidate;
    candidate = html.indexOf(prefix, candidate + prefix.length);
  }
  return -1;
}

function findHtmlTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return -1;
}

function removeHtmlLinkElements(
  html: string,
  elements: HtmlLinkElement[],
  removed: ReadonlySet<number>,
): string {
  let cursor = 0;
  let output = "";
  for (const [index, element] of elements.entries()) {
    if (!removed.has(index)) continue;
    output += html.slice(cursor, element.start);
    cursor = element.end;
  }
  return output + html.slice(cursor);
}

function splitLinkHeader(value: string): string[] {
  const links: string[] = [];
  let start = 0;
  let insideAngleBrackets = false;
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && !isEscaped(value, index)) quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === "<") {
      insideAngleBrackets = true;
    } else if (character === ">") {
      insideAngleBrackets = false;
    } else if (character === "," && !insideAngleBrackets) {
      links.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  links.push(value.slice(start).trim());
  return links.filter(Boolean);
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function normalizeBudget(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}
