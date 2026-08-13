import { normalizePath, type Plugin } from "vite";
import { compileReactModule } from "./compiler";
import {
  normalizeReactCompilerOptions,
  type NormalizedReactCompilerOptions,
} from "./index";

interface RendererPluginOptions {
  ssr?: boolean;
  rendererOptions?: Readonly<Record<string, unknown>>;
}

function readCompilerOptions(
  rendererOptions: Readonly<Record<string, unknown>> | undefined,
): NormalizedReactCompilerOptions | false {
  const experimental = rendererOptions?.experimental;
  if (!experimental || typeof experimental !== "object") return false;
  const compiler = (experimental as { compiler?: unknown }).compiler;
  if (!compiler) return false;
  if (compiler === true) return normalizeReactCompilerOptions(true);
  if (typeof compiler !== "object") {
    throw new TypeError(
      "React experimental.compiler must be a boolean or compiler options object.",
    );
  }
  const normalized = compiler as Partial<NormalizedReactCompilerOptions>;
  if (
    (normalized.mode === "infer" || normalized.mode === "annotation") &&
    typeof normalized.directive === "string" &&
    (normalized.onUnsupported === "fallback" ||
      normalized.onUnsupported === "warn" ||
      normalized.onUnsupported === "error")
  ) {
    return normalized as NormalizedReactCompilerOptions;
  }
  return normalizeReactCompilerOptions(
    compiler as NormalizedReactCompilerOptions,
  );
}

export function createFarmRendererPlugin(
  options: RendererPluginOptions = {},
): Plugin[] {
  const compilerOptions = readCompilerOptions(options.rendererOptions);
  if (!compilerOptions) return [];

  let projectRoot = "";

  return [
    {
      name: "farm:react-aot-compiler",
      enforce: "pre",
      configResolved(config) {
        projectRoot = normalizePath(config.root).replace(/\/$/, "");
      },
      async transform(code, id) {
        const cleanId = normalizePath(id.split("?", 1)[0]);
        if (
          !/\.[jt]sx$/.test(cleanId) ||
          cleanId.includes("/node_modules/") ||
          (projectRoot && !cleanId.startsWith(`${projectRoot}/`))
        )
          return null;

        const result = await compileReactModule(code, cleanId, compilerOptions);
        for (const diagnostic of result.diagnostics) {
          const message = `[react-compiler] ${diagnostic.component}: ${diagnostic.reason}; using React.`;
          if (compilerOptions.onUnsupported === "error") this.error(message);
          if (compilerOptions.onUnsupported === "warn" || diagnostic.selected)
            this.warn(message);
        }
        if (result.compiled.length === 0) return null;
        return { code: result.code, map: result.map as any };
      },
    },
  ];
}
