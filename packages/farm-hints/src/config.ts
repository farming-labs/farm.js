export type HintsReport = "overlay" | "console" | "both";
export type HintsOverlayPosition = "bottom-right" | "bottom-left";
export type HintsOverlayOpen = "issues" | "always" | "collapsed";
export type HintsAccessibilityLevel = "A" | "AA" | "AAA";
export type HintsImpact = "minor" | "moderate" | "serious" | "critical";

export interface AccessibilityHintsOptions {
  /** WCAG conformance level included in the axe scan. Defaults to AA. */
  level?: HintsAccessibilityLevel;
  /** Lowest axe impact shown by the plugin. Defaults to moderate. */
  impact?: HintsImpact;
  /** CSS selectors excluded from accessibility scans. */
  exclude?: string[];
  /** Per-rule axe overrides. */
  rules?: Record<string, { enabled: boolean }>;
}

export interface PerformanceHintsOptions {
  /** Largest Contentful Paint warning threshold in milliseconds. */
  lcp?: number;
  /** Cumulative Layout Shift warning threshold. */
  cls?: number;
  /** Interaction to Next Paint warning threshold in milliseconds. */
  inp?: number;
  /** Farm hydration warning threshold in milliseconds. */
  hydration?: number;
  /** Farm client navigation warning threshold in milliseconds. */
  navigation?: number;
}

export interface ThirdPartyHintsOptions {
  /** Resource duration that marks a third-party script as slow, in milliseconds. */
  slow?: number;
  /** Allowed origins or hostnames that should not be reported. */
  allow?: string[];
}

export interface HintsOverlayOptions {
  /** Screen edge used by the overlay. Defaults to bottom-right. */
  position?: HintsOverlayPosition;
  /** Initial overlay state. Defaults to issues. */
  open?: HintsOverlayOpen;
}

export interface HintsOptions {
  /** Run WCAG checks with axe-core. Defaults to true. */
  accessibility?: boolean | AccessibilityHintsOptions;
  /** Track Core Web Vitals, Farm timings, and layout-risk hints. Defaults to true. */
  performance?: boolean | PerformanceHintsOptions;
  /** Check live DOM structure for common HTML mistakes. Defaults to true. */
  html?: boolean;
  /** Inventory and flag blocking or slow third-party scripts. Defaults to true. */
  thirdParty?: boolean | ThirdPartyHintsOptions;
  /** Where findings are presented. Defaults to overlay. */
  report?: HintsReport;
  /** Overlay placement and initial state. */
  overlay?: HintsOverlayOptions;
  /** Maximum number of findings kept per scan. Defaults to 50. */
  maxIssues?: number;
}

export interface ResolvedAccessibilityHintsOptions {
  level: HintsAccessibilityLevel;
  impact: HintsImpact;
  exclude: string[];
  rules: Record<string, { enabled: boolean }>;
}

export interface ResolvedPerformanceHintsOptions {
  lcp: number;
  cls: number;
  inp: number;
  hydration: number;
  navigation: number;
}

export interface ResolvedThirdPartyHintsOptions {
  slow: number;
  allow: string[];
}

export interface ResolvedHintsOptions {
  accessibility: false | ResolvedAccessibilityHintsOptions;
  performance: false | ResolvedPerformanceHintsOptions;
  html: boolean;
  thirdParty: false | ResolvedThirdPartyHintsOptions;
  report: HintsReport;
  overlay: {
    position: HintsOverlayPosition;
    open: HintsOverlayOpen;
  };
  maxIssues: number;
}

const PERFORMANCE_DEFAULTS: ResolvedPerformanceHintsOptions = {
  lcp: 2_500,
  cls: 0.1,
  inp: 200,
  hydration: 500,
  navigation: 1_000,
};

/** Validate and expand the concise public options into browser-safe configuration. */
export function resolveHintsOptions(options: HintsOptions = {}): ResolvedHintsOptions {
  assertObject(options, "hints options");
  assertBooleanOrObject(options.accessibility, "accessibility");
  assertBooleanOrObject(options.performance, "performance");
  assertBoolean(options.html, "html");
  assertBooleanOrObject(options.thirdParty, "thirdParty");

  const report = options.report ?? "overlay";
  if (report !== "overlay" && report !== "console" && report !== "both") {
    throw new TypeError('hints report must be "overlay", "console", or "both"');
  }

  const overlay = options.overlay ?? {};
  assertObject(overlay, "hints overlay");
  const position = overlay.position ?? "bottom-right";
  if (position !== "bottom-right" && position !== "bottom-left") {
    throw new TypeError('hints overlay.position must be "bottom-right" or "bottom-left"');
  }
  const open = overlay.open ?? "issues";
  if (open !== "issues" && open !== "always" && open !== "collapsed") {
    throw new TypeError('hints overlay.open must be "issues", "always", or "collapsed"');
  }

  const maxIssues = options.maxIssues ?? 50;
  assertPositiveNumber(maxIssues, "maxIssues");

  return {
    accessibility: resolveAccessibility(options.accessibility),
    performance: resolvePerformance(options.performance),
    html: options.html ?? true,
    thirdParty: resolveThirdParty(options.thirdParty),
    report,
    overlay: { position, open },
    maxIssues: Math.floor(maxIssues),
  };
}

function resolveAccessibility(
  value: HintsOptions["accessibility"],
): false | ResolvedAccessibilityHintsOptions {
  if (value === false) return false;
  const options = value === true || value === undefined ? {} : value;
  const level = options.level ?? "AA";
  if (level !== "A" && level !== "AA" && level !== "AAA") {
    throw new TypeError('hints accessibility.level must be "A", "AA", or "AAA"');
  }
  const impact = options.impact ?? "moderate";
  if (!(["minor", "moderate", "serious", "critical"] as const).includes(impact)) {
    throw new TypeError("hints accessibility.impact is invalid");
  }
  assertStringArray(options.exclude, "accessibility.exclude");
  if (options.rules !== undefined) {
    assertObject(options.rules, "hints accessibility.rules");
    for (const [rule, config] of Object.entries(options.rules)) {
      assertObject(config, `hints accessibility.rules.${rule}`);
      if (typeof config.enabled !== "boolean") {
        throw new TypeError(`hints accessibility.rules.${rule}.enabled must be boolean`);
      }
    }
  }
  return {
    level,
    impact,
    exclude: [...(options.exclude ?? [])],
    rules: { ...options.rules },
  };
}

function resolvePerformance(
  value: HintsOptions["performance"],
): false | ResolvedPerformanceHintsOptions {
  if (value === false) return false;
  const options = value === true || value === undefined ? {} : value;
  const resolved = { ...PERFORMANCE_DEFAULTS, ...options };
  for (const key of Object.keys(PERFORMANCE_DEFAULTS) as Array<keyof typeof resolved>) {
    assertPositiveNumber(resolved[key], `performance.${key}`);
  }
  return resolved;
}

function resolveThirdParty(
  value: HintsOptions["thirdParty"],
): false | ResolvedThirdPartyHintsOptions {
  if (value === false) return false;
  const options = value === true || value === undefined ? {} : value;
  const slow = options.slow ?? 1_000;
  assertPositiveNumber(slow, "thirdParty.slow");
  assertStringArray(options.allow, "thirdParty.allow");
  return { slow, allow: [...(options.allow ?? [])] };
}

function assertObject(value: unknown, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertBooleanOrObject(value: unknown, key: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    assertObject(value, `hints ${key}`);
  }
}

function assertBoolean(value: unknown, key: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`hints ${key} must be boolean`);
  }
}

function assertPositiveNumber(value: unknown, key: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`hints ${key} must be a positive finite number`);
  }
}

function assertStringArray(value: unknown, key: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`hints ${key} must be an array of non-empty strings`);
  }
}
