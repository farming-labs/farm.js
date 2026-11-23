import preactPreset from "@preact/preset-vite";
import { normalizePath, type PluginOption } from "vite";

// The React entry points compiled code and the compiler runtime import, and their Preact
// equivalents (the same mapping @preact/preset-vite applies with resolve.alias).
const PREACT_COMPAT_IDS: Readonly<Record<string, string>> = {
  react: "preact/compat",
  "react-dom": "preact/compat",
  "react-dom/client": "preact/compat/client",
  "react/jsx-runtime": "preact/jsx-runtime",
  "react/jsx-dev-runtime": "preact/jsx-runtime",
};

interface SourceNode {
  type: string;
  start: number;
  end: number;
  value?: unknown;
}

/** Replaces React import and re-export specifiers with their preact/compat equivalents. */
export function rewriteReactSpecifiers(
  code: string,
  program: { body: readonly unknown[] },
): string | null {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const typed = node as { type?: string; source?: SourceNode } & Record<string, unknown>;
    const source = typed.source;
    if (
      (typed.type === "ImportDeclaration" ||
        typed.type === "ExportNamedDeclaration" ||
        typed.type === "ExportAllDeclaration" ||
        typed.type === "ImportExpression") &&
      source?.type === "Literal" &&
      typeof source.value === "string" &&
      PREACT_COMPAT_IDS[source.value]
    ) {
      edits.push({
        start: source.start,
        end: source.end,
        text: JSON.stringify(PREACT_COMPAT_IDS[source.value]),
      });
    }
    for (const [key, value] of Object.entries(typed)) {
      if (key !== "source" && value && typeof value === "object") visit(value);
    }
  };
  visit(program.body);
  if (edits.length === 0) return null;
  let result = code;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

interface RendererPluginOptions {
  ssr?: boolean;
  buildLifetime?: AbortSignal;
  rendererOptions?: Readonly<Record<string, unknown>>;
}

export async function createFarmRendererPlugin(
  options: RendererPluginOptions = {},
): Promise<PluginOption[]> {
  const compiler = Boolean(options.rendererOptions?.compiler);
  let projectRoot = "";
  const reactCompat: PluginOption = {
    name: "farm:preact-react-compat",
    configResolved(config) {
      projectRoot = normalizePath(config.root).replace(/\/$/, "");
    },
    // Farm's server build keeps react and react-dom external for non-React renderers, and a
    // bundler checks that list before any alias or resolveId hook. Rewrite the specifiers in
    // Farm's own modules, the compiler runtime, and the app's modules instead, so Farm's hooks
    // and compiled components run on the server with the same preact/compat they hydrate with,
    // and an app without React installed still builds and starts.
    transform(code, id, transformOptions) {
      if (!transformOptions?.ssr) return null;
      const cleanId = normalizePath(id.split("?", 1)[0]);
      if (!/\.[cm]?[jt]sx?$/.test(cleanId)) return null;
      const isFarmModule = /\/(?:farm|@farm\.js\/core|farm-react|@farm\.js\/react)\/dist\//.test(
        cleanId,
      );
      const isAppModule =
        projectRoot !== "" &&
        cleanId.startsWith(`${projectRoot}/`) &&
        !cleanId.includes("/node_modules/");
      if (!isFarmModule && !isAppModule) return null;
      if (!/["'](?:react|react-dom)(?:\/[\w-]+)?["']/.test(code)) return null;
      return rewriteReactSpecifiers(code, this.parse(code));
    },
    config: () => ({
      // Load Farm, these bindings (which import Farm), and the compiler runtime through Vite on
      // the server, so their react and react-dom imports take the preact/compat aliases there
      // as they do in the browser. Left external, Node would load real React, which a Preact app
      // need not install, and server-rendered compiled components would mix React elements with
      // Preact ones.
      ssr: {
        noExternal: ["@farm.js/core", "@farm.js/preact", ...(compiler ? ["@farm.js/react"] : [])],
      },
    }),
  };
  const plugins: PluginOption[] = [preactPreset(), reactCompat];
  if (!compiler) return plugins;
  // preact({ compiler }): Farm's AOT compiler emits React-shaped code and imports
  // @farm.js/react/compiler-runtime, which the preset resolves to preact/compat.
  let compilerModule: typeof import("@farm.js/react/vite");
  try {
    compilerModule = await import("@farm.js/react/vite");
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (
      (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
      String((error as Error).message).includes("@farm.js/react")
    ) {
      throw Object.assign(
        new Error(
          "preact({ compiler }) needs @farm.js/react. Install it alongside @farm.js/preact.",
        ),
        { cause: error },
      );
    }
    throw error;
  }
  return [...plugins, ...compilerModule.createFarmRendererPlugin(options)];
}
