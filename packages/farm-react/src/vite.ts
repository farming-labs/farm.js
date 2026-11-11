import { normalizePath, type Plugin } from "vite";
import { compileReactModule } from "./compiler";
import { getReactCompilerBuildCache } from "./compiler-build-cache";
import { resolveCompilerOption } from "./compiler-options";
import { writeReactCompilerReport, type ReactCompilerModuleObservation } from "./compiler-report";
import { normalizeReactCompilerOptions, type NormalizedReactCompilerOptions } from "./index";

interface RendererPluginOptions {
  ssr?: boolean;
  /** Build-owned disposal signal shared by discovery, client and SSR graphs. */
  buildLifetime?: AbortSignal;
  rendererOptions?: Readonly<Record<string, unknown>>;
}

function readCompilerOptions(
  rendererOptions: Readonly<Record<string, unknown>> | undefined,
): NormalizedReactCompilerOptions | false {
  // Renderer options built by an older `react()` or by hand may still carry
  // the deprecated `experimental.compiler` shape.
  const compiler = resolveCompilerOption(rendererOptions);
  if (!compiler) return false;
  if (compiler === true) return normalizeReactCompilerOptions(true);
  const normalized = compiler as Partial<NormalizedReactCompilerOptions>;
  if (
    (normalized.mode === "infer" || normalized.mode === "annotation") &&
    typeof normalized.directive === "string" &&
    (normalized.reactivity === "static" || normalized.reactivity === "hybrid") &&
    (normalized.onUnsupported === "fallback" ||
      normalized.onUnsupported === "warn" ||
      normalized.onUnsupported === "error")
  ) {
    return normalized as NormalizedReactCompilerOptions;
  }
  return normalizeReactCompilerOptions(compiler as NormalizedReactCompilerOptions);
}

interface SourceLiteral {
  type: string;
  start: number;
  end: number;
  value?: unknown;
}

/**
 * Points `import { createRoot } from "react-dom/client"` at the compiled root. Imports that also
 * name anything else (hydrateRoot, a default or namespace import) are left to React DOM.
 */
export function rewriteCompiledRootImports(
  code: string,
  program: { body: readonly unknown[] },
): string | null {
  const edits: SourceLiteral[] = [];
  for (const statement of program.body) {
    const node = statement as {
      type?: string;
      importKind?: string;
      source?: SourceLiteral;
      specifiers?: Array<{ type: string; imported?: { name?: string; value?: string } }>;
    };
    if (
      node.type !== "ImportDeclaration" ||
      node.importKind === "type" ||
      node.source?.value !== "react-dom/client" ||
      !node.specifiers?.length ||
      !node.specifiers.every(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          (specifier.imported?.name ?? specifier.imported?.value) === "createRoot",
      )
    ) {
      continue;
    }
    edits.push(node.source);
  }
  if (edits.length === 0) return null;
  let result = code;
  for (const literal of edits.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, literal.start)}"@farm.js/react/compiled-root"${result.slice(literal.end)}`;
  }
  return result;
}

export function createFarmRendererPlugin(options: RendererPluginOptions = {}): Plugin[] {
  const compilerOptions = readCompilerOptions(options.rendererOptions);
  if (!compilerOptions) return [];

  let projectRoot = "";
  const reportEnabled = compilerOptions.report && options.ssr !== true;
  const reportObservations = new Map<string, ReactCompilerModuleObservation>();

  return [
    {
      name: "farm:react-aot-compiler",
      enforce: "pre",
      configResolved(config) {
        projectRoot = normalizePath(config.root).replace(/\/$/, "");
      },
      buildStart() {
        reportObservations.clear();
      },
      async transform(code, id) {
        const cleanId = normalizePath(id.split("?", 1)[0]);
        if (
          !/\.[jt]sx$/.test(cleanId) ||
          cleanId.includes("/node_modules/") ||
          (projectRoot && !cleanId.startsWith(`${projectRoot}/`))
        )
          return null;

        const cache = options.buildLifetime && getReactCompilerBuildCache(options.buildLifetime);
        // The compiler does not consume Vite's SSR flag or graph transforms.
        // Only exact compiler inputs can cross graph boundaries. No key work
        // or retained cache is introduced on the ordinary development path.
        const result = cache
          ? await cache.compile(
              JSON.stringify([
                projectRoot,
                cleanId,
                compilerOptions,
                process.env.NODE_ENV,
                process.env.BABEL_ENV,
                code,
              ]),
              () => compileReactModule(code, cleanId, compilerOptions),
            )
          : await compileReactModule(code, cleanId, compilerOptions);
        if (reportEnabled) {
          if (result.compiled.length > 0 || result.diagnostics.length > 0) {
            reportObservations.set(cleanId, { id: cleanId, result });
          } else {
            reportObservations.delete(cleanId);
          }
        }
        for (const diagnostic of result.diagnostics) {
          const message = `[react-compiler] ${diagnostic.component}: ${diagnostic.reason}; using React.`;
          if (compilerOptions.onUnsupported === "error") this.error(message);
          if (compilerOptions.onUnsupported === "warn" || diagnostic.selected) this.warn(message);
        }
        if (result.compiled.length === 0) return null;
        return { code: result.code, map: result.map as any };
      },
      async buildEnd(error) {
        if (error || !reportEnabled || !projectRoot) return;
        await writeReactCompilerReport(
          projectRoot,
          compilerOptions.reportFile,
          reportObservations.values(),
        );
      },
    },
    {
      // Runs after TypeScript and JSX are compiled, so the module parses as JavaScript.
      name: "farm:react-compiled-root",
      transform(code, id, transformOptions) {
        if (compilerOptions.compiledRoot === false || options.ssr || transformOptions?.ssr) {
          return null;
        }
        if (!code.includes("react-dom/client")) return null;
        const cleanId = normalizePath(id.split("?", 1)[0]);
        if (
          !/\.[cm]?[jt]sx?$/.test(cleanId) ||
          cleanId.includes("/node_modules/") ||
          (projectRoot && !cleanId.startsWith(`${projectRoot}/`))
        ) {
          return null;
        }
        return rewriteCompiledRootImports(code, this.parse(code));
      },
    },
  ];
}
