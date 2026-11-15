import type { ReactCompilerOptions } from "./index";

let warnedExperimentalCompiler = false;

// Shared by react() and the Vite adapter, including descriptors from older renderers.
export function resolveCompilerOption(
  options: { compiler?: unknown; experimental?: unknown } = {},
  warnDeprecated = false,
): boolean | ReactCompilerOptions | undefined {
  const experimental = options.experimental;
  const legacy =
    experimental && typeof experimental === "object"
      ? (experimental as { compiler?: unknown }).compiler
      : undefined;
  if (legacy !== undefined && options.compiler !== undefined) {
    throw new TypeError(
      "Configure the React compiler with `compiler` only; remove `experimental.compiler`.",
    );
  }
  const compiler = legacy === undefined ? options.compiler : legacy;
  if (
    compiler !== undefined &&
    typeof compiler !== "boolean" &&
    (compiler === null || typeof compiler !== "object" || Array.isArray(compiler))
  ) {
    throw new TypeError("React compiler must be a boolean or compiler options object.");
  }
  if (legacy !== undefined && warnDeprecated && !warnedExperimentalCompiler) {
    warnedExperimentalCompiler = true;
    console.warn(
      "[farm] `react({ experimental: { compiler } })` is deprecated. Use `react({ compiler })`.",
    );
  }
  return compiler as boolean | ReactCompilerOptions | undefined;
}
