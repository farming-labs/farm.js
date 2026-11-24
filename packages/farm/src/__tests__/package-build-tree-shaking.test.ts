// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";
import { farmPackageBuildOptions } from "../../tsup.config";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// What esbuild's keepNames emits around every function in core's dist.
const KEEP_NAMES_HELPER = `var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
`;

async function bundleAppImport(coreSource: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-core-tree-shaking-"));
  dirs.push(dir);
  await writeFile(join(dir, "core.mjs"), coreSource);
  await writeFile(
    join(dir, "app.mjs"),
    'import { used } from "./core.mjs";\nconsole.log(used());\n',
  );
  const bundle = await rolldown({ input: join(dir, "app.mjs") });
  const { output } = await bundle.generate({ format: "esm" });
  await bundle.close();
  return output.map((chunk) => ("code" in chunk ? chunk.code : "")).join("\n");
}

describe("@farm.js/core package build", () => {
  it("does not wrap functions in keepNames' __name calls", () => {
    const options: { keepNames?: boolean } = {};
    farmPackageBuildOptions.esbuildOptions?.(options as never, { format: "esm" });
    expect(options.keepNames).not.toBe(true);
  });

  it("lets an app's bundler drop core functions the app never calls", async () => {
    const core = `export function used() { return 1; }
function unusedResolver() { return "UNUSED_CORE_CODE"; }
export { unusedResolver };
`;
    expect(await bundleAppImport(core)).not.toContain("UNUSED_CORE_CODE");
    // With keepNames, the same unused function survives every app build.
    const withKeepNames = `${KEEP_NAMES_HELPER}${core}__name(unusedResolver, "unusedResolver");\n`;
    expect(await bundleAppImport(withKeepNames)).toContain("UNUSED_CORE_CODE");
  });

  // An islands client entry imports core's client runtime, and only the router it loads on a
  // navigation reconciles the document head. A module with a top-level side effect runs with the
  // chunk that imports it first, so the head helpers stay out of the entry only while they have
  // none (RFC 0013).
  it("lets an app's bundler keep navigation's head helpers out of the entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-core-navigation-chunk-"));
    dirs.push(dir);
    const head = join(import.meta.dirname, "../client/document-head.ts");
    await writeFile(
      join(dir, "runtime.mjs"),
      `export { reconcileFarmDocumentHead } from ${JSON.stringify(head)};\nexport function boot() { return "BOOT"; }\n`,
    );
    await writeFile(
      join(dir, "entry.mjs"),
      'import { boot } from "./runtime.mjs";\nconsole.log(boot());\nimport("./router.mjs").then((router) => router.swap(document));\n',
    );
    await writeFile(
      join(dir, "router.mjs"),
      'import { reconcileFarmDocumentHead } from "./runtime.mjs";\nexport const swap = reconcileFarmDocumentHead;\n',
    );
    const bundle = await rolldown({ input: join(dir, "entry.mjs") });
    const { output } = await bundle.generate({ format: "esm" });
    await bundle.close();
    const chunks = output.filter((chunk) => chunk.type === "chunk");
    const entry = chunks.find((chunk) => chunk.isEntry)!;
    expect(entry.code).toContain("BOOT");
    expect(entry.code).not.toContain("meta[http-equiv]");
    expect(chunks.some((chunk) => !chunk.isEntry && chunk.code.includes("meta[http-equiv]"))).toBe(
      true,
    );
  });
});
