"use client";

import {
  cloneScriptDefinition,
  markScriptHandle,
  normalizeScriptBasePath,
  normalizeScriptDefinition,
  sameScriptDefinition,
  withScriptBasePath,
} from "./shared.js";
import type {
  ResolvedScriptDefinition,
  ScriptConsentState,
  ScriptDefinition,
  ScriptHandle,
  ScriptRuntime,
  ScriptSnapshot,
  ScriptStatus,
  ScriptStatusListener,
} from "./types.js";

export type {
  AnyScriptHandle,
  ResolvedScriptDefinition,
  ScriptConsentState,
  ScriptDefinition,
  ScriptDuration,
  ScriptHandle,
  ScriptLoadStrategy,
  ScriptSnapshot,
  ScriptStatus,
  ScriptStatusListener,
} from "./types.js";

const SCRIPT_STORE = Symbol.for("@farm.js/scripts.browser-store");

interface ScriptEntry {
  definition: Readonly<ResolvedScriptDefinition>;
  configured: boolean;
  status: ScriptStatus;
  attempt: number;
  error?: unknown;
  promise?: Promise<unknown>;
  triggered: boolean;
  listeners: Set<ScriptStatusListener>;
  requestListeners: Set<() => void>;
}

interface ScriptStore {
  window: Window & typeof globalThis;
  basePath: string;
  entries: Map<string, ScriptEntry>;
  consent: Map<string, ScriptConsentState>;
}

type ScriptWindow = Window & typeof globalThis & { [SCRIPT_STORE]?: ScriptStore };

export class ScriptEnvironmentError extends Error {
  override name = "ScriptEnvironmentError";
}

export class ScriptNotRegisteredError extends Error {
  override name = "ScriptNotRegisteredError";
}

export class ScriptConsentRequiredError extends Error {
  override name = "ScriptConsentRequiredError";
  constructor(
    readonly scriptName: string,
    readonly category: string,
  ) {
    super(
      `Script ${JSON.stringify(scriptName)} requires granted consent for ${JSON.stringify(category)}`,
    );
  }
}

export class ScriptLoadError extends Error {
  override name = "ScriptLoadError";
  constructor(
    readonly scriptName: string,
    readonly src: string,
  ) {
    super(`Script ${JSON.stringify(scriptName)} failed to load from ${JSON.stringify(src)}`);
  }
}

export class ScriptTimeoutError extends Error {
  override name = "ScriptTimeoutError";
  constructor(
    readonly scriptName: string,
    readonly timeoutMs: number,
  ) {
    super(`Script ${JSON.stringify(scriptName)} did not load within ${timeoutMs} ms`);
  }
}

export class ScriptGlobalMissingError extends Error {
  override name = "ScriptGlobalMissingError";
  constructor(
    readonly scriptName: string,
    readonly globalPath: string,
  ) {
    super(
      `Script ${JSON.stringify(scriptName)} loaded but did not expose global ${JSON.stringify(globalPath)}`,
    );
  }
}

/** Define one typed external browser script. Register the returned handle with `scripts()`. */
export function defineScript<T = void>(definition: ScriptDefinition): ScriptHandle<T> {
  const resolved = normalizeScriptDefinition(definition);
  registerLocalDefinition(resolved);

  const handle = {
    name: resolved.name,
    definition: resolved,
    get status(): ScriptStatus {
      const store = currentStore();
      return store?.entries.get(resolved.name)?.status ?? "idle";
    },
    get error(): unknown {
      const store = currentStore();
      return store?.entries.get(resolved.name)?.error;
    },
    async load(): Promise<T> {
      const store = requireBrowserStore(resolved.name);
      return (await loadRegisteredScript(store, resolved.name)) as T;
    },
    async use<TResult>(
      callback: (sdk: T) => TResult | PromiseLike<TResult>,
    ): Promise<Awaited<TResult>> {
      if (typeof callback !== "function") {
        throw new TypeError("script use callback must be a function");
      }
      const sdk = await handle.load();
      return (await callback(sdk)) as Awaited<TResult>;
    },
    subscribe(listener: ScriptStatusListener): () => void {
      if (typeof listener !== "function") {
        throw new TypeError("script status listener must be a function");
      }
      const store = currentStore();
      if (!store) return () => {};
      const entry = ensureEntry(store, resolved, false);
      entry.listeners.add(listener);
      callListener(store, listener, snapshot(entry));
      return () => entry.listeners.delete(listener);
    },
  } satisfies ScriptHandle<T>;

  return Object.freeze(markScriptHandle(handle, resolved));
}

/** Set an application-owned consent category. Consent is intentionally not persisted by Farm. */
export function setScriptConsent(category: string, state: ScriptConsentState): void {
  const normalized = normalizeConsentCategory(category);
  if (state !== "unknown" && state !== "granted" && state !== "denied") {
    throw new TypeError('script consent state must be "unknown", "granted", or "denied"');
  }
  const store = currentStore();
  if (!store) return;
  if (state === "unknown") store.consent.delete(normalized);
  else store.consent.set(normalized, state);

  if (state === "granted") {
    for (const entry of triggeredConsentDependents(store, normalized)) {
      if (entry.status === "ready" || entry.status === "loading") continue;
      void loadRegisteredScript(store, entry.definition.name).catch((error) => {
        if (!(error instanceof ScriptConsentRequiredError)) reportAutomaticError(store, error);
      });
    }
  } else {
    for (const entry of store.entries.values()) {
      if (
        entry.definition.consent === normalized &&
        entry.triggered &&
        entry.status !== "ready" &&
        entry.status !== "loading"
      ) {
        setEntryState(store, entry, "blocked");
      }
    }
  }
}

export function grantScriptConsent(category: string): void {
  setScriptConsent(category, "granted");
}

export function denyScriptConsent(category: string): void {
  setScriptConsent(category, "denied");
}

export function clearScriptConsent(category: string): void {
  setScriptConsent(category, "unknown");
}

export function getScriptConsent(category: string): ScriptConsentState {
  const normalized = normalizeConsentCategory(category);
  const store = currentStore();
  if (!store) return "unknown";
  return store.consent.get(normalized) ?? "unknown";
}

/** @internal Start the browser lifecycle for definitions serialized by the Farm plugin. */
export function startScriptRuntime(
  definitions: readonly ResolvedScriptDefinition[],
  runtimeWindow: Window & typeof globalThis = window,
  basePath = "/",
): ScriptRuntime {
  const store = getStore(runtimeWindow, basePath);
  const entries = definitions.map((definition) =>
    ensureEntry(store, cloneScriptDefinition(definition), true),
  );
  let closed = false;
  let idleHandle: number | undefined;
  let interactionHandler: (() => void) | undefined;
  let mutationObserver: MutationObserver | undefined;
  let refreshQueued = false;
  const visibleObservers = new Map<
    string,
    { observer: IntersectionObserver; targets: Map<Element, Set<string>> }
  >();

  for (const entry of entries) {
    if (
      entry.definition.preconnect &&
      (!entry.definition.consent || getConsent(store, entry.definition.consent) === "granted")
    ) {
      addPreconnect(store, entry.definition);
    }
  }

  function unobserveScript(name: string): void {
    for (const { observer, targets } of visibleObservers.values()) {
      for (const [element, names] of targets) {
        names.delete(name);
        if (names.size > 0) continue;
        observer.unobserve(element);
        targets.delete(element);
      }
    }
  }

  function request(entry: ScriptEntry): void {
    if (closed) return;
    entry.triggered = true;
    void loadRegisteredScript(store, entry.definition.name).catch((error) => {
      if (!(error instanceof ScriptConsentRequiredError)) reportAutomaticError(store, error);
    });
  }

  function requestByStrategy(strategy: string): void {
    for (const entry of entries) {
      if (entry.definition.load === strategy) request(entry);
    }
  }

  function refreshVisible(): void {
    if (closed) return;
    for (const { observer, targets } of visibleObservers.values()) {
      for (const element of targets.keys()) {
        if (element.isConnected) continue;
        observer.unobserve(element);
        targets.delete(element);
      }
    }
    for (const entry of entries) {
      const strategy = entry.definition.load;
      if (typeof strategy !== "object" || strategy.when !== "visible" || entry.triggered) continue;
      let elements: NodeListOf<Element>;
      try {
        elements = runtimeWindow.document.querySelectorAll(strategy.selector);
      } catch {
        const error = new TypeError(
          `Script ${JSON.stringify(entry.definition.name)} has invalid visible selector ${JSON.stringify(strategy.selector)}`,
        );
        entry.triggered = true;
        setEntryState(store, entry, "error", error);
        reportAutomaticError(store, error);
        continue;
      }
      for (const element of elements) {
        const group = visibleObservers.get(strategy.rootMargin);
        if (!group) {
          request(entry);
          break;
        }
        const names = group.targets.get(element) ?? new Set<string>();
        if (names.has(entry.definition.name)) continue;
        names.add(entry.definition.name);
        group.targets.set(element, names);
        group.observer.observe(element);
      }
    }
  }

  function scheduleVisibleRefresh(): void {
    if (closed || refreshQueued) return;
    refreshQueued = true;
    runtimeWindow.queueMicrotask(() => {
      refreshQueued = false;
      refreshVisible();
    });
  }

  const visibleEntries = entries.filter((entry) => typeof entry.definition.load === "object");
  const visibleRequestListeners = new Map<ScriptEntry, () => void>();
  for (const entry of visibleEntries) {
    const listener = () => unobserveScript(entry.definition.name);
    entry.requestListeners.add(listener);
    visibleRequestListeners.set(entry, listener);
  }
  if (visibleEntries.length > 0) {
    const Observer = runtimeWindow.IntersectionObserver;
    if (typeof Observer === "function") {
      for (const entry of visibleEntries) {
        const strategy = entry.definition.load;
        if (typeof strategy !== "object" || visibleObservers.has(strategy.rootMargin)) continue;
        const targets = new Map<Element, Set<string>>();
        const observer = new Observer(
          (observations) => {
            for (const observation of observations) {
              if (!observation.isIntersecting) continue;
              const names = targets.get(observation.target);
              if (!names) continue;
              observer.unobserve(observation.target);
              targets.delete(observation.target);
              for (const name of names) {
                const visibleEntry = store.entries.get(name);
                if (visibleEntry) request(visibleEntry);
              }
            }
          },
          { rootMargin: strategy.rootMargin },
        );
        visibleObservers.set(strategy.rootMargin, { observer, targets });
      }
    }
    const Mutation = runtimeWindow.MutationObserver;
    if (typeof Mutation === "function") {
      mutationObserver = new Mutation(scheduleVisibleRefresh);
      mutationObserver.observe(runtimeWindow.document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    scheduleVisibleRefresh();
  }

  requestByStrategy("immediate");

  if (entries.some((entry) => entry.definition.load === "idle")) {
    if (typeof runtimeWindow.requestIdleCallback === "function") {
      idleHandle = runtimeWindow.requestIdleCallback(() => requestByStrategy("idle"), {
        timeout: 2_000,
      });
    } else {
      idleHandle = runtimeWindow.setTimeout(() => requestByStrategy("idle"), 1);
    }
  }

  if (entries.some((entry) => entry.definition.load === "interaction")) {
    interactionHandler = () => {
      removeInteractionListeners(runtimeWindow, interactionHandler!);
      interactionHandler = undefined;
      requestByStrategy("interaction");
    };
    addInteractionListeners(runtimeWindow, interactionHandler);
  }

  return {
    afterHydration() {
      requestByStrategy("after-hydration");
      scheduleVisibleRefresh();
    },
    refresh: scheduleVisibleRefresh,
    close() {
      if (closed) return;
      closed = true;
      if (idleHandle !== undefined) {
        if (typeof runtimeWindow.cancelIdleCallback === "function") {
          runtimeWindow.cancelIdleCallback(idleHandle);
        } else {
          runtimeWindow.clearTimeout(idleHandle);
        }
      }
      if (interactionHandler) removeInteractionListeners(runtimeWindow, interactionHandler);
      for (const { observer, targets } of visibleObservers.values()) {
        observer.disconnect();
        targets.clear();
      }
      for (const [entry, listener] of visibleRequestListeners) {
        entry.requestListeners.delete(listener);
      }
      mutationObserver?.disconnect();
      visibleObservers.clear();
    },
  };
}

function currentStore(): ScriptStore | undefined {
  if (typeof window === "undefined") return undefined;
  return getStore(window);
}

function requireBrowserStore(name: string): ScriptStore {
  const store = currentStore();
  if (!store) {
    throw new ScriptEnvironmentError(
      `Script ${JSON.stringify(name)} can only be loaded in a browser environment`,
    );
  }
  return store;
}

function getStore(runtimeWindow: Window & typeof globalThis, basePath?: string): ScriptStore {
  const host = runtimeWindow as ScriptWindow;
  if (host[SCRIPT_STORE]) {
    if (basePath !== undefined) host[SCRIPT_STORE]!.basePath = normalizeScriptBasePath(basePath);
    return host[SCRIPT_STORE]!;
  }
  const store: ScriptStore = {
    window: runtimeWindow,
    basePath: normalizeScriptBasePath(basePath),
    entries: new Map(),
    consent: new Map(),
  };
  Object.defineProperty(host, SCRIPT_STORE, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: store,
  });
  return store;
}

function registerLocalDefinition(definition: Readonly<ResolvedScriptDefinition>): void {
  const store = currentStore();
  if (store) ensureEntry(store, definition, false);
}

function ensureEntry(
  store: ScriptStore,
  definition: Readonly<ResolvedScriptDefinition>,
  configured: boolean,
): ScriptEntry {
  const existing = store.entries.get(definition.name);
  if (existing) {
    if (!sameScriptDefinition(existing.definition, definition)) {
      throw new TypeError(
        `Script ${JSON.stringify(definition.name)} was defined with conflicting options`,
      );
    }
    if (configured) existing.configured = true;
    return existing;
  }
  const entry: ScriptEntry = {
    definition,
    configured,
    status: "idle",
    attempt: 0,
    triggered: false,
    listeners: new Set(),
    requestListeners: new Set(),
  };
  store.entries.set(definition.name, entry);
  return entry;
}

async function loadRegisteredScript(
  store: ScriptStore,
  name: string,
  stack: string[] = [],
): Promise<unknown> {
  const entry = store.entries.get(name);
  if (!entry?.configured) {
    throw new ScriptNotRegisteredError(
      `Script ${JSON.stringify(name)} is not registered. Pass its defineScript() handle to scripts({ scripts: [...] })`,
    );
  }
  entry.triggered = true;
  for (const listener of entry.requestListeners) listener();
  if (entry.status === "ready") {
    try {
      return requireLoadedValue(store, entry.definition);
    } catch (error) {
      setEntryState(store, entry, "error", error);
    }
  }
  if (entry.promise) return entry.promise;
  if (entry.definition.consent && getConsent(store, entry.definition.consent) !== "granted") {
    setEntryState(store, entry, "blocked");
    throw new ScriptConsentRequiredError(name, entry.definition.consent);
  }
  if (entry.definition.preconnect) addPreconnect(store, entry.definition);
  if (stack.includes(name)) {
    throw new Error(
      `Script dependency cycle reached in the browser: ${[...stack, name].join(" -> ")}`,
    );
  }

  const promise = (async () => {
    for (const dependency of entry.definition.dependsOn) {
      try {
        await loadRegisteredScript(store, dependency, [...stack, name]);
      } catch (error) {
        if (error instanceof ScriptConsentRequiredError) setEntryState(store, entry, "blocked");
        else setEntryState(store, entry, "error", error);
        throw error;
      }
    }

    setEntryState(store, entry, "loading");
    const maximumAttempts = entry.definition.retries + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      entry.attempt = attempt;
      notify(store, entry);
      try {
        const value = await loadElement(store, entry.definition);
        setEntryState(store, entry, "ready");
        return value;
      } catch (error) {
        lastError = error;
        if (attempt < maximumAttempts) {
          await delay(store.window, entry.definition.retryDelayMs);
        }
      }
    }
    setEntryState(store, entry, "error", lastError);
    throw lastError;
  })();

  entry.promise = promise;
  try {
    return await promise;
  } finally {
    if (entry.promise === promise && entry.status !== "loading") entry.promise = undefined;
  }
}

async function loadElement(
  store: ScriptStore,
  definition: Readonly<ResolvedScriptDefinition>,
): Promise<unknown> {
  const existingValue = findLoadedValue(store, definition);
  if (existingValue.found) return existingValue.value;

  removeStaleElements(store.window.document, definition.name);
  const script = store.window.document.createElement("script");
  script.dataset.farmScript = definition.name;
  script.src = withScriptBasePath(definition.src, store.basePath);
  script.async = definition.async;
  if (definition.type === "module") script.type = "module";
  if (definition.id) script.id = definition.id;
  if (definition.integrity) script.integrity = definition.integrity;
  if (definition.crossOrigin) script.crossOrigin = definition.crossOrigin;
  if (definition.referrerPolicy) script.referrerPolicy = definition.referrerPolicy;
  if (definition.fetchPriority) script.setAttribute("fetchpriority", definition.fetchPriority);
  for (const [key, value] of Object.entries(definition.attributes)) {
    script.setAttribute(key, value);
  }

  const parent =
    definition.placement === "body"
      ? (store.window.document.body ?? store.window.document.head)
      : (store.window.document.head ?? store.window.document.body);
  if (!parent) {
    throw new ScriptLoadError(definition.name, withScriptBasePath(definition.src, store.basePath));
  }

  const loaded = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      store.window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (error) {
        script.dataset.farmScriptState = "error";
        script.remove();
        reject(error);
      } else {
        script.dataset.farmScriptState = "ready";
        resolve();
      }
    };
    const onLoad = () => finish();
    const onError = () => finish(new ScriptLoadError(definition.name, script.src));
    const timeout = store.window.setTimeout(
      () => finish(new ScriptTimeoutError(definition.name, definition.timeoutMs)),
      definition.timeoutMs,
    );
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
  });

  parent.append(script);
  try {
    await loaded;
    if (!definition.global) return undefined;
    return await waitForGlobal(store, definition);
  } catch (error) {
    script.dataset.farmScriptState = "error";
    script.remove();
    throw error;
  }
}

async function waitForGlobal(
  store: ScriptStore,
  definition: Readonly<ResolvedScriptDefinition>,
): Promise<unknown> {
  const immediate = findLoadedValue(store, definition);
  if (immediate.found) return immediate.value;
  if (definition.readyTimeoutMs === 0) {
    throw new ScriptGlobalMissingError(definition.name, definition.global!);
  }
  const deadline = Date.now() + definition.readyTimeoutMs;
  while (Date.now() < deadline) {
    await delay(store.window, Math.min(25, Math.max(1, deadline - Date.now())));
    const result = findLoadedValue(store, definition);
    if (result.found) return result.value;
  }
  throw new ScriptGlobalMissingError(definition.name, definition.global!);
}

function findLoadedValue(
  store: ScriptStore,
  definition: Readonly<ResolvedScriptDefinition>,
): { found: boolean; value?: unknown } {
  if (!definition.global) {
    const element = findManagedElement(store.window.document, definition.name);
    return { found: element?.dataset.farmScriptState === "ready", value: undefined };
  }
  let owner: unknown = store.window;
  for (const segment of definition.global.split(".")) {
    if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) {
      return { found: false };
    }
    owner = Reflect.get(owner, segment);
  }
  const found = owner !== undefined && owner !== null;
  return { found, ...(found ? { value: owner } : {}) };
}

function requireLoadedValue(
  store: ScriptStore,
  definition: Readonly<ResolvedScriptDefinition>,
): unknown {
  const result = findLoadedValue(store, definition);
  if (result.found) return result.value;
  throw new ScriptGlobalMissingError(definition.name, definition.global!);
}

function findManagedElement(document: Document, name: string): HTMLScriptElement | undefined {
  for (const element of document.querySelectorAll<HTMLScriptElement>("script[data-farm-script]")) {
    if (element.dataset.farmScript === name) return element;
  }
  return undefined;
}

function removeStaleElements(document: Document, name: string): void {
  for (const element of document.querySelectorAll<HTMLScriptElement>("script[data-farm-script]")) {
    if (element.dataset.farmScript === name) element.remove();
  }
}

function addPreconnect(store: ScriptStore, definition: Readonly<ResolvedScriptDefinition>): void {
  let source: URL;
  try {
    source = new URL(definition.src, store.window.location.href);
  } catch {
    return;
  }
  if (source.origin === store.window.location.origin) return;
  for (const link of store.window.document.querySelectorAll<HTMLLinkElement>(
    'link[rel="preconnect"][data-farm-script-preconnect]',
  )) {
    if (link.href === source.origin + "/") return;
  }
  const link = store.window.document.createElement("link");
  link.rel = "preconnect";
  link.href = source.origin;
  link.dataset.farmScriptPreconnect = definition.name;
  if (definition.crossOrigin) link.crossOrigin = definition.crossOrigin;
  store.window.document.head?.append(link);
}

function addInteractionListeners(runtimeWindow: Window, listener: () => void): void {
  const options: AddEventListenerOptions = { capture: true, passive: true, once: true };
  runtimeWindow.document.addEventListener("pointerdown", listener, options);
  runtimeWindow.document.addEventListener("keydown", listener, options);
  runtimeWindow.document.addEventListener("touchstart", listener, options);
}

function removeInteractionListeners(runtimeWindow: Window, listener: () => void): void {
  runtimeWindow.document.removeEventListener("pointerdown", listener, true);
  runtimeWindow.document.removeEventListener("keydown", listener, true);
  runtimeWindow.document.removeEventListener("touchstart", listener, true);
}

function getConsent(store: ScriptStore, category: string): ScriptConsentState {
  return store.consent.get(category) ?? "unknown";
}

function triggeredConsentDependents(store: ScriptStore, category: string): ScriptEntry[] {
  const names = new Set(
    [...store.entries.values()]
      .filter((entry) => entry.triggered && entry.definition.consent === category)
      .map((entry) => entry.definition.name),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of store.entries.values()) {
      if (
        entry.triggered &&
        !names.has(entry.definition.name) &&
        entry.definition.dependsOn.some((dependency) => names.has(dependency))
      ) {
        names.add(entry.definition.name);
        changed = true;
      }
    }
  }
  return [...names].map((name) => store.entries.get(name)!);
}

function normalizeConsentCategory(category: string): string {
  if (typeof category !== "string" || !category.trim()) {
    throw new TypeError("script consent category must be a non-empty string");
  }
  return category.trim();
}

function setEntryState(
  store: ScriptStore,
  entry: ScriptEntry,
  status: ScriptStatus,
  error?: unknown,
): void {
  entry.status = status;
  entry.error = error;
  notify(store, entry);
}

function notify(store: ScriptStore, entry: ScriptEntry): void {
  const value = snapshot(entry);
  for (const listener of entry.listeners) callListener(store, listener, value);
}

function snapshot(entry: ScriptEntry): Readonly<ScriptSnapshot> {
  return Object.freeze({
    name: entry.definition.name,
    status: entry.status,
    attempt: entry.attempt,
    ...(entry.error === undefined ? {} : { error: entry.error }),
  });
}

function callListener(
  store: ScriptStore,
  listener: ScriptStatusListener,
  value: Readonly<ScriptSnapshot>,
): void {
  try {
    listener(value);
  } catch (error) {
    store.window.console.error("[farm:scripts] A status listener failed", error);
  }
}

function reportAutomaticError(store: ScriptStore, error: unknown): void {
  store.window.console.warn("[farm:scripts] An automatically loaded script failed", error);
}

function delay(runtimeWindow: Window & typeof globalThis, durationMs: number): Promise<void> {
  if (durationMs === 0) return Promise.resolve();
  return new Promise((resolve) => runtimeWindow.setTimeout(resolve, durationMs));
}
