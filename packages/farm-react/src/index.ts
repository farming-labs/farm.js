import type { FarmRenderer } from "@farm.js/core/renderer";

export type ReactCompilerMode = "infer" | "annotation";
export type UnsupportedCompilerBehavior = "fallback" | "warn" | "error";

export interface ReactCompilerOptions {
  /** Compile every component that the safe subset can prove eligible. */
  mode?: ReactCompilerMode;
  /** Function or module directive used only by annotation mode. */
  directive?: string;
  /** What to do when a selected component is outside the safe subset. */
  onUnsupported?: UnsupportedCompilerBehavior;
}

export interface ReactRendererOptions {
  experimental?: {
    /** `true` enables automatic inference; an object customizes selection. */
    compiler?: boolean | ReactCompilerOptions;
  };
}

export interface NormalizedReactCompilerOptions {
  mode: ReactCompilerMode;
  directive: string;
  onUnsupported: UnsupportedCompilerBehavior;
}

export const DEFAULT_COMPILER_DIRECTIVE = "use compiler";

export function normalizeReactCompilerOptions(
  value: true | ReactCompilerOptions,
): NormalizedReactCompilerOptions {
  const options = value === true ? {} : value;
  const mode = options.mode || "infer";

  if (mode !== "infer" && mode !== "annotation") {
    throw new TypeError(`Unknown React compiler mode: ${String(mode)}`);
  }

  if (options.directive !== undefined && mode !== "annotation") {
    throw new TypeError(
      "The React compiler directive can only be configured in annotation mode.",
    );
  }

  const directive = options.directive?.trim() || DEFAULT_COMPILER_DIRECTIVE;
  const onUnsupported = options.onUnsupported || "fallback";
  if (!(["fallback", "warn", "error"] as const).includes(onUnsupported)) {
    throw new TypeError(
      `Unknown unsupported-component behavior: ${String(onUnsupported)}`,
    );
  }

  return { mode, directive, onUnsupported };
}

const REACT_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "react",
  vite: "@farm.js/react/vite",
  server: "@farm.js/react/server",
  client: "@farm.js/react/client",
  jsxImportSource: "react",
  dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  optimizeDeps: [
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "@farm.js/react/compiler-runtime",
  ],
  capabilities: {
    streaming: { node: true, web: false },
  },
});

/** Select React and optionally enable Farm's experimental AOT compiler. */
export function react(options: ReactRendererOptions = {}): FarmRenderer {
  const compiler = options.experimental?.compiler;
  const normalizedCompiler = compiler
    ? normalizeReactCompilerOptions(compiler)
    : false;

  return {
    ...REACT_RENDERER,
    dedupe: [...(REACT_RENDERER.dedupe || [])],
    optimizeDeps: [...(REACT_RENDERER.optimizeDeps || [])],
    capabilities: {
      streaming: { ...REACT_RENDERER.capabilities?.streaming },
    },
    options: {
      experimental: { compiler: normalizedCompiler },
    },
  };
}

export { REACT_RENDERER };
export type { FarmRenderer } from "@farm.js/core/renderer";
