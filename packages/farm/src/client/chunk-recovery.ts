"use client";

export interface FarmChunkRecoveryOptions {
  /**
   * How long a page is considered already recovered before another chunk
   * failure may trigger a reload. Defaults to 30 seconds.
   */
  maxAgeMs?: number;
  /**
   * Override the storage key. Mostly useful for tests and embedded runtimes.
   */
  storageKey?: string;
  /**
   * Called right before Farm reloads the page.
   */
  onRecover?: (error: unknown) => void;
  /**
   * Test hooks for browser globals.
   */
  reload?: () => void;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  location?: Pick<Location, "pathname" | "search" | "reload">;
  now?: () => number;
}

const DEFAULT_MAX_AGE_MS = 30_000;
const STORAGE_KEY_PREFIX = "farm:chunk-recovery:";
const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /CSS_CHUNK_LOAD_FAILED/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload CSS/i,
  /module script failed/i,
];

export function isChunkLoadError(errorLike: unknown): boolean {
  const values = collectErrorText(errorLike);
  if (values.some((value) => CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(value)))) {
    return true;
  }

  const targetUrl = getEventTargetAssetUrl(errorLike);
  return Boolean(targetUrl && /\.(?:m?js|css)(?:[?#].*)?$/i.test(targetUrl));
}

export function installChunkErrorRecovery(options: FarmChunkRecoveryOptions = {}): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const recover = (errorLike: unknown) => {
    if (!isChunkLoadError(errorLike)) {
      return;
    }
    if (!markRecovered(options)) {
      return;
    }

    options.onRecover?.(errorLike);
    getReload(options)();
  };

  const onError = (event: Event | ErrorEvent) => {
    recover(getErrorEventPayload(event));
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    recover(event.reason);
  };

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

function markRecovered(options: FarmChunkRecoveryOptions): boolean {
  const now = getNow(options);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const storage = getStorage(options);
  const key = getStorageKey(options);

  if (!storage) {
    return true;
  }

  try {
    const previous = Number(storage.getItem(key));
    if (Number.isFinite(previous) && previous > 0 && now - previous < maxAgeMs) {
      return false;
    }
    storage.setItem(key, String(now));
    return true;
  } catch {
    return true;
  }
}

function getErrorEventPayload(event: Event | ErrorEvent): unknown {
  if ("error" in event && event.error) {
    return event.error;
  }
  if ("message" in event && event.message) {
    return event.message;
  }
  return event;
}

function collectErrorText(value: unknown, seen = new Set<unknown>()): string[] {
  if (value == null || seen.has(value)) {
    return [];
  }
  seen.add(value);

  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const output: string[] = [];

  for (const key of ["name", "message", "code", "type", "request", "src", "href"]) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      output.push(candidate);
    }
  }

  if ("reason" in record) {
    output.push(...collectErrorText(record.reason, seen));
  }
  if ("error" in record) {
    output.push(...collectErrorText(record.error, seen));
  }

  return output;
}

function getEventTargetAssetUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const target = (value as Event).target as
    | (EventTarget & { src?: string; href?: string; tagName?: string })
    | null
    | undefined;
  if (!target || typeof target !== "object") {
    return undefined;
  }

  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tagName !== "script" && tagName !== "link") {
    return undefined;
  }

  return typeof target.src === "string" && target.src
    ? target.src
    : typeof target.href === "string" && target.href
      ? target.href
      : undefined;
}

function getStorage(options: FarmChunkRecoveryOptions) {
  if ("storage" in options) {
    return options.storage;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getStorageKey(options: FarmChunkRecoveryOptions): string {
  if (options.storageKey) {
    return options.storageKey;
  }

  const location = getLocation(options);
  return `${STORAGE_KEY_PREFIX}${location.pathname}${location.search}`;
}

function getLocation(options: FarmChunkRecoveryOptions) {
  return options.location ?? window.location;
}

function getReload(options: FarmChunkRecoveryOptions): () => void {
  if (options.reload) {
    return options.reload;
  }

  const location = getLocation(options);
  return () => location.reload();
}

function getNow(options: FarmChunkRecoveryOptions): number {
  return options.now ? options.now() : Date.now();
}
