import type { ResolvedHintsOptions } from "./config.js";
import type { HintIssue, HintSeverity } from "./types.js";

const INTERACTIVE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"]';
const IMPACT_ORDER = { minor: 0, moderate: 1, serious: 2, critical: 3 } as const;

/** Collect current-document findings. Runtime metrics are merged separately by the client runtime. */
export async function collectDocumentHints(
  document: Document,
  window: Window,
  options: ResolvedHintsOptions,
): Promise<HintIssue[]> {
  const groups = await Promise.all([
    options.accessibility ? scanAccessibility(document, options) : [],
    options.performance ? scanPerformance(document) : [],
    options.html ? scanHtml(document) : [],
    options.thirdParty ? scanThirdParty(document, window, options) : [],
  ]);

  const issues = groups.flat();
  const accessibilityNestedControls = new Set<Element>();
  for (const issue of issues) {
    if (!issue.id.startsWith("accessibility:nested-interactive:") || !issue.selector) continue;
    const element = querySelector(document, issue.selector);
    if (element) accessibilityNestedControls.add(element);
  }

  return issues
    .filter((issue) => {
      if (!issue.id.startsWith("html:nested-interactive:") || !issue.selector) return true;
      const element = querySelector(document, issue.selector);
      return !element || !accessibilityNestedControls.has(element);
    })
    .sort(compareIssues)
    .slice(0, options.maxIssues);
}

async function scanAccessibility(
  document: Document,
  options: ResolvedHintsOptions,
): Promise<HintIssue[]> {
  if (!options.accessibility) return [];
  const axeModule = await import("axe-core");
  const axe = axeModule.default;
  const values = ["wcag2a", "wcag21a", "wcag22a"];
  if (options.accessibility.level !== "A") {
    values.push("wcag2aa", "wcag21aa", "wcag22aa");
  }
  if (options.accessibility.level === "AAA") values.push("wcag2aaa");

  const context = {
    include: [["html"]],
    exclude: [["farm-hints"], ...options.accessibility.exclude.map((selector) => [selector])],
  };
  const result = await axe.run(context, {
    runOnly: { type: "tag", values },
    rules: options.accessibility.rules,
  });
  const minimum = IMPACT_ORDER[options.accessibility.impact];

  return result.violations.flatMap((violation) => {
    const impact = violation.impact ?? "moderate";
    if (!(impact in IMPACT_ORDER) || IMPACT_ORDER[impact as keyof typeof IMPACT_ORDER] < minimum) {
      return [];
    }
    return violation.nodes.map((node, index): HintIssue => {
      const selector = selectorFromAxeTarget(node.target);
      return {
        id: `accessibility:${violation.id}:${selector || index}`,
        category: "accessibility",
        severity: impactToSeverity(impact),
        title: violation.help,
        detail: cleanDetail(node.failureSummary || violation.description),
        selector,
        snippet: node.html,
        helpUrl: violation.helpUrl,
      };
    });
  });
}

function scanPerformance(document: Document): HintIssue[] {
  return Array.from(document.images).flatMap((image, index): HintIssue[] => {
    if (image.closest("farm-hints")) return [];
    if (
      hasPositiveIntegerAttribute(image, "width") &&
      hasPositiveIntegerAttribute(image, "height")
    ) {
      return [];
    }
    const selector = createSelector(image);
    return [
      {
        id: `performance:image-size:${selector || index}`,
        category: "performance",
        severity: "warning",
        title: "Image has no intrinsic size",
        detail:
          "Add width and height attributes so the browser knows the image ratio before it loads. CSS can also reserve space, but intrinsic dimensions are the most reliable default.",
        selector,
        snippet: image.outerHTML.slice(0, 240),
      },
    ];
  });
}

function hasPositiveIntegerAttribute(element: Element, name: string): boolean {
  const value = element.getAttribute(name)?.trim();
  return value !== undefined && /^[1-9]\d*$/.test(value);
}

function scanHtml(document: Document): HintIssue[] {
  const issues: HintIssue[] = [];

  if (!document.doctype || document.doctype.name.toLowerCase() !== "html") {
    issues.push({
      id: "html:doctype",
      category: "html",
      severity: "serious",
      title: "Document has no HTML doctype",
      detail: "Add <!doctype html> so browsers render the page in standards mode.",
    });
  }

  if (!document.documentElement.lang.trim()) {
    issues.push({
      id: "html:document-language",
      category: "html",
      severity: "warning",
      title: "Document language is missing",
      detail:
        "Set the lang attribute on <html> so browsers and assistive technology use the right language.",
      selector: "html",
      snippet: document.documentElement.outerHTML.slice(0, 160),
    });
  }

  const ids = new Map<string, Element[]>();
  for (const element of document.querySelectorAll("[id]")) {
    if (element.closest("farm-hints")) continue;
    const id = element.id;
    if (!id) continue;
    const matches = ids.get(id) ?? [];
    matches.push(element);
    ids.set(id, matches);
  }
  for (const [id, elements] of ids) {
    if (elements.length < 2) continue;
    issues.push({
      id: `html:duplicate-id:${id}`,
      category: "html",
      severity: "serious",
      title: `Duplicate id “${id}”`,
      detail: `${elements.length} elements use this id. IDs must be unique for labels, fragments, scripts, and accessibility APIs to resolve predictably.`,
      selector: `#${escapeCss(id)}`,
      snippet: elements[0].outerHTML.slice(0, 240),
    });
  }

  for (const parent of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
    if (parent.closest("farm-hints")) continue;
    const child = parent.querySelector(INTERACTIVE_SELECTOR);
    if (!child) continue;
    const selector = createSelector(parent);
    issues.push({
      id: `html:nested-interactive:${selector}`,
      category: "html",
      severity: "serious",
      title: "Interactive control is nested",
      detail:
        "Place interactive controls beside each other instead. Nested controls create ambiguous keyboard and pointer behavior.",
      selector,
      snippet: parent.outerHTML.slice(0, 240),
    });
  }

  return issues;
}

function scanThirdParty(
  document: Document,
  window: Window,
  options: ResolvedHintsOptions,
): HintIssue[] {
  if (!options.thirdParty) return [];
  const issues: HintIssue[] = [];
  const scripts = Array.from(document.scripts);
  const durations = new Map<string, number>();

  for (const entry of window.performance.getEntriesByType("resource")) {
    const resource = entry as PerformanceResourceTiming;
    if (resource.initiatorType === "script") durations.set(resource.name, resource.duration);
  }

  for (const [index, script] of scripts.entries()) {
    if (!script.src) continue;
    const url = safeUrl(script.src, window.location.href);
    if (!url || url.origin === window.location.origin) continue;
    if (isAllowedThirdParty(url, options.thirdParty.allow)) continue;

    const selector = createSelector(script);
    const duration = durations.get(url.href);
    const blocking =
      script.parentElement === document.head &&
      !script.async &&
      !script.defer &&
      script.type.toLowerCase() !== "module";
    const slow = duration !== undefined && duration >= options.thirdParty.slow;

    issues.push({
      id: `third-party:script:${url.origin}:${selector || index}`,
      category: "third-party",
      severity: blocking ? "serious" : slow ? "warning" : "info",
      title: blocking
        ? `Blocking script from ${url.hostname}`
        : slow
          ? `Slow script from ${url.hostname}`
          : `Third-party script from ${url.hostname}`,
      detail: blocking
        ? "This script can delay HTML parsing. Load it with async, defer, or type=module when its execution order allows it."
        : slow
          ? `The resource took ${Math.round(duration)} ms to load. Confirm it is needed on this route or defer it until interaction.`
          : "Confirm this script is needed on this route and load it after critical page work when possible.",
      selector,
      snippet: script.outerHTML.slice(0, 240),
    });
  }

  return issues;
}

export function createSelector(element: Element): string {
  if (element.id) return `#${escapeCss(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (
    current &&
    current !== current.ownerDocument.documentElement &&
    current !== current.ownerDocument.body &&
    parts.length < 4
  ) {
    let part = current.localName;
    const testId = current.getAttribute("data-testid");
    if (testId) {
      part += `[data-testid="${escapeAttribute(testId)}"]`;
      parts.unshift(part);
      break;
    }
    const parent: Element | null = current.parentElement;
    if (parent) {
      const currentName = current.localName;
      const peers = Array.from(parent.children).filter(
        (child: Element) => child.localName === currentName,
      );
      if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(" > ");
}

function selectorFromAxeTarget(target: readonly unknown[]): string | undefined {
  const candidate = target[0];
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate))
    return candidate.filter((part) => typeof part === "string").join(" ");
  return undefined;
}

function querySelector(document: Document, selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function impactToSeverity(impact: string): HintSeverity {
  if (impact === "critical") return "critical";
  if (impact === "serious") return "serious";
  if (impact === "moderate") return "warning";
  return "info";
}

function compareIssues(left: HintIssue, right: HintIssue): number {
  const severity = { critical: 0, serious: 1, warning: 2, info: 3 } as const;
  return (
    severity[left.severity] - severity[right.severity] || left.title.localeCompare(right.title)
  );
}

function cleanDetail(value: string): string {
  const parts = value
    .replace(/^Fix (?:any|all) of the following:\s*/i, "")
    .split(/\r?\n/)
    .map((part) => part.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const detail = parts.join(". ").replace(/\.{2,}/g, ".");
  return detail.length > 320 ? `${detail.slice(0, 317).trimEnd()}…` : detail;
}

function safeUrl(value: string, base: string): URL | undefined {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedThirdParty(url: URL, allow: string[]): boolean {
  return allow.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    return normalized === url.origin.toLowerCase() || normalized === url.hostname.toLowerCase();
  });
}

function escapeCss(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
