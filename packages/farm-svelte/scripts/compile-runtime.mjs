import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(packageRoot, "src", "compat-root.svelte");
const outputDirectory = path.join(packageRoot, "src", "generated");
const source = await fs.readFile(sourcePath, "utf8");

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

for (const generate of ["client", "server"]) {
  const outputPath = path.join(outputDirectory, `compat-root.${generate}.ts`);
  const compiled = compile(source, {
    filename: outputPath,
    generate,
    css: "external",
    dev: false,
  });
  await fs.writeFile(
    outputPath,
    `// @ts-nocheck\n// Generated from src/compat-root.svelte. Do not edit directly.\n${compiled.js.code}\n`,
    "utf8",
  );
}
