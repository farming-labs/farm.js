import type {
  AnyScriptHandle,
  ResolvedScriptDefinition,
  ResolvedScriptLoadStrategy,
  ScriptDefinition,
  ScriptDependency,
  ScriptDuration,
  ScriptHandle,
} from "./types.js";

export const FARM_SCRIPT_HANDLE = Symbol.for("@farm.js/scripts.handle");

const SAFE_GLOBAL_SEGMENT = /^[A-Za-z_$][\w$]*$/;
const UNSAFE_GLOBAL_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const REFERRER_POLICIES = new Set<ReferrerPolicy>([
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
]);

interface MarkedScriptHandle {
  readonly [FARM_SCRIPT_HANDLE]: Readonly<ResolvedScriptDefinition>;
}

export function markScriptHandle<T>(
  handle: ScriptHandle<T>,
  definition: ResolvedScriptDefinition,
): ScriptHandle<T> {
  Object.defineProperty(handle, FARM_SCRIPT_HANDLE, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: definition,
  });
  return handle;
}

export function readScriptHandle(value: unknown): Readonly<ResolvedScriptDefinition> | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, FARM_SCRIPT_HANDLE);
  if (!descriptor || !("value" in descriptor)) return undefined;
  return descriptor.value as Readonly<ResolvedScriptDefinition>;
}

export function normalizeScriptDefinition(input: ScriptDefinition): ResolvedScriptDefinition {
  if (!isPlainObject(input)) throw new TypeError("script definition must be an object");

  const name = normalizeText(input.name, "name");
  if (
    [...name].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
  ) {
    throw new TypeError("script name cannot contain control characters");
  }
  const src = normalizeScriptSource(input.src);
  const global = input.global === undefined ? undefined : validateGlobalPath(input.global);
  const load = normalizeLoadStrategy(input.load);
  const consent =
    input.consent === undefined ? undefined : normalizeText(input.consent, "consent category");
  const dependsOn = normalizeDependencies(input.dependsOn);
  const type = input.type ?? "classic";
  if (type !== "classic" && type !== "module") {
    throw new TypeError('script type must be "classic" or "module"');
  }
  const placement = input.placement ?? "head";
  if (placement !== "head" && placement !== "body") {
    throw new TypeError('script placement must be "head" or "body"');
  }
  assertBoolean(input.async, "async");
  assertBoolean(input.preconnect, "preconnect");
  const retries = input.retries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
    throw new TypeError("script retries must be an integer from 0 to 10");
  }
  const crossOrigin = input.crossOrigin;
  if (
    crossOrigin !== undefined &&
    crossOrigin !== "anonymous" &&
    crossOrigin !== "use-credentials"
  ) {
    throw new TypeError('script crossOrigin must be "anonymous" or "use-credentials"');
  }
  if (input.referrerPolicy !== undefined && !REFERRER_POLICIES.has(input.referrerPolicy)) {
    throw new TypeError("script referrerPolicy is not a supported browser referrer policy");
  }
  if (
    input.fetchPriority !== undefined &&
    input.fetchPriority !== "high" &&
    input.fetchPriority !== "low" &&
    input.fetchPriority !== "auto"
  ) {
    throw new TypeError('script fetchPriority must be "high", "low", or "auto"');
  }

  const definition: ResolvedScriptDefinition = {
    name,
    src,
    load,
    dependsOn,
    type,
    placement,
    async: input.async ?? true,
    timeoutMs: parseScriptDuration(input.timeout ?? "15s", "timeout", false),
    readyTimeoutMs: parseScriptDuration(input.readyTimeout ?? "1s", "readyTimeout", true),
    retries,
    retryDelayMs: parseScriptDuration(input.retryDelay ?? 250, "retryDelay", true),
    preconnect: input.preconnect ?? false,
    attributes: normalizeDataAttributes(input.attributes),
    ...(global ? { global } : {}),
    ...(consent ? { consent } : {}),
    ...(input.id === undefined ? {} : { id: normalizeText(input.id, "id") }),
    ...(input.integrity === undefined
      ? {}
      : { integrity: normalizeText(input.integrity, "integrity") }),
    ...(crossOrigin ? { crossOrigin } : {}),
    ...(input.referrerPolicy === undefined ? {} : { referrerPolicy: input.referrerPolicy }),
    ...(input.fetchPriority === undefined ? {} : { fetchPriority: input.fetchPriority }),
  };

  return deepFreezeDefinition(definition);
}

export function cloneScriptDefinition(
  definition: Readonly<ResolvedScriptDefinition>,
): ResolvedScriptDefinition {
  return deepFreezeDefinition({
    ...definition,
    load: typeof definition.load === "object" ? { ...definition.load } : definition.load,
    dependsOn: [...definition.dependsOn],
    attributes: { ...definition.attributes },
  });
}

export function sameScriptDefinition(
  left: Readonly<ResolvedScriptDefinition>,
  right: Readonly<ResolvedScriptDefinition>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function scriptHandleName(value: ScriptDependency): string {
  if (typeof value === "string") return normalizeText(value, "dependency");
  const definition = readScriptHandle(value);
  if (!definition) {
    throw new TypeError("script dependency must be a script name or a defineScript() handle");
  }
  return definition.name;
}

export function parseScriptDuration(
  value: ScriptDuration,
  label: string,
  allowZero: boolean,
): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
      throw new TypeError(
        `script ${label} must be ${allowZero ? "a non-negative" : "a positive"} finite duration`,
      );
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new TypeError(`script ${label} must be a number or duration string`);
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(value);
  if (!match) {
    throw new TypeError(`script ${label} must use a duration such as "250ms", "5s", or "1m"`);
  }
  const amount = Number(match[1]);
  if (!allowZero && amount === 0) {
    throw new TypeError(`script ${label} must be a positive duration`);
  }
  const multiplier = match[2] === "ms" ? 1 : match[2] === "s" ? 1_000 : 60_000;
  return amount * multiplier;
}

export function validateGlobalPath(value: unknown): string {
  const path = normalizeText(value, "global");
  const segments = path.split(".");
  if (segments[0] === "window" || segments[0] === "globalThis" || segments[0] === "self") {
    throw new TypeError(
      `script global is relative to window; use ${JSON.stringify(segments.slice(1).join("."))}`,
    );
  }
  if (
    segments.some(
      (segment) =>
        !SAFE_GLOBAL_SEGMENT.test(segment) || UNSAFE_GLOBAL_SEGMENTS.has(segment.toLowerCase()),
    )
  ) {
    throw new TypeError(
      `script global must be a safe dotted path, received ${JSON.stringify(path)}`,
    );
  }
  return path;
}

export function isMarkedScriptHandle(
  value: unknown,
): value is AnyScriptHandle & MarkedScriptHandle {
  return readScriptHandle(value) !== undefined;
}

export function normalizeScriptBasePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

export function withScriptBasePath(source: string, basePath: string): string {
  if (!source.startsWith("/") || source.startsWith("//")) return source;
  const normalizedBase = normalizeScriptBasePath(basePath);
  if (normalizedBase === "/") return source;
  if (source === normalizedBase || source.startsWith(`${normalizedBase}/`)) return source;
  return `${normalizedBase}${source}`;
}

function normalizeLoadStrategy(value: unknown): ResolvedScriptLoadStrategy {
  const strategy = value ?? "after-hydration";
  if (
    strategy === "immediate" ||
    strategy === "after-hydration" ||
    strategy === "idle" ||
    strategy === "interaction" ||
    strategy === "manual"
  ) {
    return strategy;
  }
  if (!isPlainObject(strategy) || strategy.when !== "visible") {
    throw new TypeError(
      'script load must be "immediate", "after-hydration", "idle", "interaction", "manual", or a visible trigger',
    );
  }
  return Object.freeze({
    when: "visible" as const,
    selector: normalizeText(strategy.selector, "visible selector"),
    rootMargin:
      strategy.rootMargin === undefined
        ? "200px"
        : normalizeText(strategy.rootMargin, "visible rootMargin"),
  });
}

function normalizeDependencies(value: readonly ScriptDependency[] | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("script dependsOn must be an array");
  return [...new Set(value.map(scriptHandleName))];
}

function normalizeScriptSource(value: unknown): string {
  const src = normalizeText(value, "src");
  const rootRelative = src.startsWith("/") && !src.startsWith("//");
  if (rootRelative) {
    const hasControlCharacter = Array.from(src).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
    if (src.includes("\\") || hasControlCharacter) {
      throw new TypeError(
        "script root-relative src cannot contain backslashes or control characters",
      );
    }
    const pathname = src.split(/[?#]/, 1)[0] || "/";
    if (pathname.split("/").some((segment) => !isStableRootRelativeSegment(segment))) {
      throw new TypeError("script root-relative src contains a browser-unstable path segment");
    }
    return src;
  }
  if (!/^https?:\/\//i.test(src)) {
    throw new TypeError("script src must be root-relative or use an absolute HTTP(S) URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    throw new TypeError(`script src must be a valid URL, received ${JSON.stringify(src)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("script src must use HTTP(S)");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("script src cannot contain URL credentials");
  }
  return src;
}

function isStableRootRelativeSegment(segment: string): boolean {
  if (!segment) return true;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed escapes remain literal in browser pathnames.
  }
  return (
    decoded !== "." &&
    decoded !== ".." &&
    !decoded.includes("/") &&
    !decoded.includes("\\") &&
    !Array.from(decoded).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    })
  );
}

function normalizeDataAttributes(value: ScriptDefinition["attributes"]): Record<string, string> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new TypeError("script attributes must be a plain object");
  const result: Record<string, string> = {};
  for (const [key, attributeValue] of Object.entries(value)) {
    if (!/^data-[a-z0-9_.:-]+$/i.test(key)) {
      throw new TypeError(`script attribute ${JSON.stringify(key)} must be a data-* attribute`);
    }
    if (key.toLowerCase().startsWith("data-farm-script")) {
      throw new TypeError(
        `script attribute ${JSON.stringify(key)} is reserved by @farm.js/scripts`,
      );
    }
    if (
      typeof attributeValue !== "string" &&
      typeof attributeValue !== "number" &&
      typeof attributeValue !== "boolean"
    ) {
      throw new TypeError(
        `script attribute ${JSON.stringify(key)} must be a string, number, or boolean`,
      );
    }
    result[key] = String(attributeValue);
  }
  return result;
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`script ${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertBoolean(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`script ${label} must be boolean`);
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreezeDefinition(definition: ResolvedScriptDefinition): ResolvedScriptDefinition {
  if (typeof definition.load === "object") Object.freeze(definition.load);
  Object.freeze(definition.dependsOn);
  Object.freeze(definition.attributes);
  return Object.freeze(definition);
}
