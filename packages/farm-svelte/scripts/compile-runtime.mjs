import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";

/**
 * Regenerates src/generated from src/compat-root.svelte.
 *
 * Several package scripts (build, type-check, test) each run this first, and
 * turbo may run them concurrently in the same directory. Generation therefore
 * must never leave a window where the outputs are missing: no directory wipe,
 * atomic rename writes, and identical content is left untouched.
 */
export async function compileRuntime(packageRoot) {
  const sourcePath = path.join(packageRoot, "src", "compat-root.svelte");
  const outputDirectory = path.join(packageRoot, "src", "generated");
  const source = await fs.readFile(sourcePath, "utf8");

  await fs.mkdir(outputDirectory, { recursive: true });

  for (const generate of ["client", "server"]) {
    const outputPath = path.join(outputDirectory, `compat-root.${generate}.ts`);
    const compiled = compile(source, {
      filename: outputPath,
      generate,
      css: "external",
      dev: false,
    });
    const contents = `// @ts-nocheck\n// Generated from src/compat-root.svelte. Do not edit directly.\n${compiled.js.code}\n`;

    const existing = await fs.readFile(outputPath, "utf8").catch(() => null);
    if (existing === contents) continue;

    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, contents, "utf8");
    try {
      await replaceFile(temporaryPath, outputPath, contents);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }
}

/**
 * Rename with Windows-aware handling: replacing a file another process holds
 * open fails with EPERM/EBUSY there. Every concurrent regeneration writes
 * identical content, so when the destination already matches, the race was
 * won by a sibling and this run is done; otherwise retry briefly.
 */
async function replaceFile(temporaryPath, outputPath, contents) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temporaryPath, outputPath);
      return;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : undefined;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      const current = await fs.readFile(outputPath, "utf8").catch(() => null);
      if (current === contents) return;
      if (attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
}

const isDirectInvocation =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await compileRuntime(packageRoot);
}
