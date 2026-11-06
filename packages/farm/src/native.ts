/**
 * `@farm.js/core/native`: web screens call the app's own native modules (RFC 0004, 7.5).
 *
 * ```ts
 * import { native } from "@farm.js/core/native";
 *
 * if (native.Device.available()) console.log(await native.Device.model());
 * ```
 *
 * A call goes through the mobile shell's bridge to the module's Kotlin class, which checks the
 * arguments against the module's Codegen spec before the module runs. Only modules with
 * `mobile.modules.<name>.web: true` are reachable, and only their methods that return a Promise.
 * In a browser, during server rendering, or in a shell without the module, every call rejects with
 * `NativeUnavailableError`. Nothing here imports React Native.
 */

/**
 * The app's native modules, keyed by the name each spec registers. `src/farm.d.ts` fills this in
 * from the Codegen specs in `src/native/` (`NativeDevice.ts` registers `"Device"`).
 */
export interface FarmNativeModules {}

/** One module as web screens see it: its Promise methods, and `available()`. */
export type FarmNativeModule<Methods> = Methods & {
  /**
   * True inside the mobile shell when this build registered the module for web screens. Check it
   * before calling, and show the web alternative when it is false.
   */
  available(): boolean;
};

export type FarmNative = {
  readonly [Name in keyof FarmNativeModules]: FarmNativeModule<FarmNativeModules[Name]>;
};

/** The part of the shell's injected `window.__farmBridge` this module uses. */
interface FarmNativeBridge {
  has(name: string): boolean;
  call(plugin: string, method: string, args: unknown[]): Promise<unknown>;
}

const UNAVAILABLE = "native_unavailable";

/**
 * A call that cannot reach the module: outside the mobile shell, during server rendering, in a
 * shell built without the module for web screens, or on an OS whose shell does not host modules
 * yet (iOS). `native.<module>.available()` is false in each of these cases.
 */
export class NativeUnavailableError extends Error {
  override name = "NativeUnavailableError";
  readonly code = UNAVAILABLE;
  readonly module: string;
  readonly method: string;
  /** The shell's own rejection, when the bridge answered. */
  readonly cause: unknown;

  constructor(module: string, method: string, options?: { cause?: unknown }) {
    super(
      `native.${module}.${method}() is not available here. Web screens reach a native module ` +
        `only inside the Android shell, when mobile.modules.${module}.web is true in ` +
        `farm.config.ts. Check native.${module}.available() first, and show the web ` +
        "alternative when it is false.",
    );
    this.module = module;
    this.method = method;
    this.cause = options?.cause;
  }
}

/**
 * A call the shell or the module rejected. `code` is the module's own rejection code, or one of
 * the shell's: `invalid_args` (the arguments do not match the spec, and the module never ran),
 * `unknown_method` (no Promise method of that name in the spec), or `native_error` (the module
 * threw).
 */
export class NativeCallError extends Error {
  override name = "NativeCallError";
  readonly code: string;
  readonly module: string;
  readonly method: string;
  /** The bridge's rejection. */
  readonly cause: unknown;

  constructor(
    module: string,
    method: string,
    code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`native.${module}.${method}() failed (${code}): ${message}`);
    this.cause = options?.cause;
    this.code = code;
    this.module = module;
    this.method = method;
  }
}

function bridge(): FarmNativeBridge | undefined {
  const candidate = (globalThis as { __farmBridge?: Partial<FarmNativeBridge> }).__farmBridge;
  return candidate && typeof candidate.call === "function" && typeof candidate.has === "function"
    ? (candidate as FarmNativeBridge)
    : undefined;
}

function isAvailable(module: string): boolean {
  return bridge()?.has(module) === true;
}

async function invoke(module: string, method: string, input: unknown[]): Promise<unknown> {
  const shell = bridge();
  if (!shell || !shell.has(module)) throw new NativeUnavailableError(module, method);
  // Optional parameters left out at the end are absent, not null, for the spec check.
  const args = [...input];
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
  try {
    return await shell.call(module, method, args);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === UNAVAILABLE) throw new NativeUnavailableError(module, method, { cause: error });
    throw new NativeCallError(
      module,
      method,
      typeof code === "string" && code ? code : "native_error",
      String((error as { message?: unknown } | null)?.message ?? error),
      { cause: error },
    );
  }
}

/**
 * Property reads that must not look like module methods: `then` (an awaited proxy would otherwise
 * look like a promise) and the ones JSON and inspection read.
 */
const RESERVED = new Set(["then", "toJSON", "constructor", "$$typeof"]);

function createModule(module: string): object {
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy(Object.create(null) as object, {
    get(_target, method) {
      if (typeof method !== "string" || RESERVED.has(method)) return undefined;
      let fn = methods.get(method);
      if (!fn) {
        fn =
          method === "available"
            ? () => isAvailable(module)
            : (...args: unknown[]) => invoke(module, method, args);
        methods.set(method, fn);
      }
      return fn;
    },
  });
}

function createNative(): FarmNative {
  const modules = new Map<string, object>();
  return new Proxy(Object.create(null) as object, {
    get(_target, module) {
      if (typeof module !== "string" || RESERVED.has(module)) return undefined;
      let entry = modules.get(module);
      if (!entry) {
        entry = createModule(module);
        modules.set(module, entry);
      }
      return entry;
    },
  }) as FarmNative;
}

/**
 * The app's native modules for web screens: `native.Device.model()` calls the `Device` module's
 * `model` method in the shell, and `native.Device.available()` says whether it can.
 */
export const native: FarmNative = /* @__PURE__ */ createNative();
