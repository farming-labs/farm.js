import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type React from "react";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions, type ReactCompilerReactivity } from "../index";

const here = dirname(fileURLToPath(import.meta.url));
const tmpRoot = join(here, "tmp");
// A reused worker can reevaluate this module while Vite still caches its old
// file paths. Give each harness lifetime its own directory and cleanup owner.
let tmpDirectory: Promise<string> | undefined;
const runtimePath = join(here, "..", "compiler-runtime.tsx");
let sequence = 0;

async function createTemporaryDirectory(): Promise<string> {
  await mkdir(tmpRoot, { recursive: true });
  return mkdtemp(join(tmpRoot, "compiled-"));
}

/**
 * Loads one module both as written and as the compiler emits it, so a test can
 * render the same component through React and through the compiled runtime.
 */
export async function loadCompiledAndOriginal(
  source: string,
  reactivity: ReactCompilerReactivity = "hybrid",
): Promise<{
  compiled: Record<string, React.ComponentType<Record<string, unknown>>>;
  original: Record<string, React.ComponentType<Record<string, unknown>>>;
  names: readonly string[];
  reasons: string[];
  code: string;
}> {
  const result = await compileReactModule(
    source,
    "/app/Harness.tsx",
    normalizeReactCompilerOptions({ reactivity }),
  );
  // Vitest transforms the written TSX like any other test module.
  const load = async (code: string) => {
    const directory = await (tmpDirectory ??= createTemporaryDirectory());
    const file = join(directory, `module-${sequence++}.tsx`);
    await writeFile(
      file,
      code.split('"@farm.js/react/compiler-runtime"').join(JSON.stringify(runtimePath)),
    );
    return import(/* @vite-ignore */ file);
  };
  return {
    compiled: await load(result.code),
    original: await load(source),
    names: result.compiled,
    reasons: result.diagnostics.map((diagnostic) => diagnostic.reason),
    code: result.code,
  };
}

export async function removeCompiledModules(): Promise<void> {
  const ownedDirectory = tmpDirectory;
  tmpDirectory = undefined;
  if (ownedDirectory) await rm(await ownedDirectory, { force: true, recursive: true });
}

/**
 * Serializes a DOM tree with sorted attributes and live form state, so trees that React and the
 * compiled runtime build compare by meaning rather than by attribute order.
 */
export function normalizedDom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType === Node.COMMENT_NODE) return "";
  if (!(node instanceof Element)) return "";
  const attributes = [...node.attributes]
    .map((attribute) => `${attribute.name}="${attribute.value}"`)
    .sort()
    .join(" ");
  const state =
    node instanceof HTMLInputElement
      ? ` [value=${node.value} checked=${node.checked}]`
      : node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement
        ? ` [value=${node.value}]`
        : "";
  const children = [...node.childNodes].map(normalizedDom).join("");
  return `<${node.localName}${attributes ? ` ${attributes}` : ""}${state}>${children}</${node.localName}>`;
}
