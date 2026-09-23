export type ScriptDuration = number | `${number}${"ms" | "s" | "m"}`;

export type ScriptLoadStrategy =
  | "immediate"
  | "after-hydration"
  | "idle"
  | "interaction"
  | "manual"
  | {
      when: "visible";
      selector: string;
      rootMargin?: string;
    };

export type ScriptStatus = "idle" | "blocked" | "loading" | "ready" | "error";
export type ScriptConsentState = "unknown" | "granted" | "denied";
export type ScriptPlacement = "head" | "body";
export type ScriptType = "classic" | "module";

export interface ScriptSnapshot {
  name: string;
  status: ScriptStatus;
  attempt: number;
  error?: unknown;
}

export type ScriptStatusListener = (snapshot: Readonly<ScriptSnapshot>) => void;

export interface ScriptHandle<T = unknown> {
  /** Stable registry name chosen by the application. */
  readonly name: string;
  /** Normalized, browser-safe definition used by the Farm plugin. */
  readonly definition: Readonly<ResolvedScriptDefinition>;
  /** Current browser loading state. SSR reads return `idle`. */
  readonly status: ScriptStatus;
  /** Last terminal loading error, when status is `error`. */
  readonly error: unknown;
  /** Load the external script and resolve its configured global. */
  load(): Promise<T>;
  /** Run code with the resolved SDK after it becomes ready. */
  use<TResult>(callback: (sdk: T) => TResult | PromiseLike<TResult>): Promise<Awaited<TResult>>;
  /** Observe state changes. The listener is called immediately in the browser. */
  subscribe(listener: ScriptStatusListener): () => void;
}

export type AnyScriptHandle = ScriptHandle<any>;
export type ScriptDependency = string | AnyScriptHandle;

export interface ScriptDefinition {
  /** Stable registry name. Local variable names can be different. */
  name: string;
  /** Root-relative or HTTP(S) script URL. */
  src: string;
  /** Safe dotted global path created by the loaded script, such as `mixpanel` or `google.maps`. */
  global?: string;
  /** When Farm should request the script. Defaults to `after-hydration`. */
  load?: ScriptLoadStrategy;
  /** Consent category that must be explicitly granted before loading. */
  consent?: string;
  /** Scripts that must become ready before this script starts loading. */
  dependsOn?: readonly ScriptDependency[];
  /** Script execution type. Defaults to `classic`. */
  type?: ScriptType;
  /** DOM destination for the generated element. Defaults to `head`. */
  placement?: ScriptPlacement;
  /** Dynamic script async behavior. Defaults to true. */
  async?: boolean;
  /** Network loading timeout. Numbers are milliseconds. Defaults to 15s. */
  timeout?: ScriptDuration;
  /** How long to wait for `global` after the script load event. Defaults to 1s. */
  readyTimeout?: ScriptDuration;
  /** Additional loading attempts after the first failure. Defaults to 0. */
  retries?: number;
  /** Delay between loading attempts. Numbers are milliseconds. Defaults to 250ms. */
  retryDelay?: ScriptDuration;
  /** Add a preconnect hint for a cross-origin script when the client runtime starts. */
  preconnect?: boolean;
  /** Optional element ID. */
  id?: string;
  /** Subresource Integrity value supplied by the script provider. */
  integrity?: string;
  /** CORS mode used by the script request. */
  crossOrigin?: "anonymous" | "use-credentials";
  /** Referrer policy used by the script request. */
  referrerPolicy?: ReferrerPolicy;
  /** Fetch priority hint. */
  fetchPriority?: "high" | "low" | "auto";
  /** Vendor-specific `data-*` attributes. */
  attributes?: Readonly<Record<`data-${string}`, string | number | boolean>>;
}

export interface ResolvedVisibleScriptLoadStrategy {
  when: "visible";
  selector: string;
  rootMargin: string;
}

export type ResolvedScriptLoadStrategy =
  | Exclude<ScriptLoadStrategy, { when: "visible" }>
  | ResolvedVisibleScriptLoadStrategy;

export interface ResolvedScriptDefinition {
  name: string;
  src: string;
  global?: string;
  load: ResolvedScriptLoadStrategy;
  consent?: string;
  dependsOn: string[];
  type: ScriptType;
  placement: ScriptPlacement;
  async: boolean;
  timeoutMs: number;
  readyTimeoutMs: number;
  retries: number;
  retryDelayMs: number;
  preconnect: boolean;
  id?: string;
  integrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  referrerPolicy?: ReferrerPolicy;
  fetchPriority?: "high" | "low" | "auto";
  attributes: Record<string, string>;
}

export interface ScriptsOptions {
  scripts: readonly AnyScriptHandle[];
}

export interface ResolvedScriptsOptions {
  scripts: ResolvedScriptDefinition[];
  basePath: string;
}

export interface ScriptRuntime {
  afterHydration(): void;
  refresh(): void;
  close(): void;
}
