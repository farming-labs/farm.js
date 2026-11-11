// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "../..");
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("server renderer", () => {
  it("loads where code generation from strings is disallowed", async () => {
    // Inside the package so the bundle's bare imports resolve from its node_modules.
    const dir = await mkdtemp(path.join(packageRoot, ".tmp-renderer-codegen-"));
    dirs.push(dir);
    const bundle = await rolldown({
      input: path.join(packageRoot, "src/server/renderer.ts"),
      external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
      logLevel: "silent",
    });
    await bundle.write({ dir, format: "esm", entryFileNames: "renderer.mjs" });
    await bundle.close();

    const { stdout } = await execFileAsync(process.execPath, [
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "--eval",
      "const renderer = await import(process.argv[1]); process.stdout.write(typeof renderer.ServerRenderer);",
      pathToFileURL(path.join(dir, "renderer.mjs")).href,
    ]);
    expect(stdout).toBe("function");
  }, 60_000);

  it("checks client plugin hooks where code generation from strings is disallowed", async () => {
    // The renderer resolves client plugins per islands request, so their hook
    // checks run in production servers that forbid eval (Cloudflare Workers).
    const dir = await mkdtemp(path.join(packageRoot, ".tmp-client-hooks-codegen-"));
    dirs.push(dir);
    const bundle = await rolldown({
      input: path.join(packageRoot, "src/client-plugin-build.ts"),
      external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
      logLevel: "silent",
    });
    await bundle.write({ dir, format: "esm", entryFileNames: "client-plugin-build.mjs" });
    await bundle.close();

    const { stdout } = await execFileAsync(process.execPath, [
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "--eval",
      [
        "const build = await import(process.argv[1]);",
        "const named = { async(value) { return value; } };",
        "const plugins = [{ name: 'hooks', client: {",
        "  setup: async (event) => event,",
        "  error: named.async,",
        "  navigation: { before: async (event) => { void event; } },",
        "} }];",
        "const resolved = build.resolveFarmClientPlugins(plugins);",
        "const { registrations } = build.generateFarmClientPluginEntryCode(plugins);",
        "process.stdout.write(JSON.stringify({",
        "  resolved: resolved.length,",
        "  arrow: registrations.includes('async (event) => event'),",
        "  method: registrations.includes('(function(value) { return value; })'),",
        "}));",
      ].join("\n"),
      pathToFileURL(path.join(dir, "client-plugin-build.mjs")).href,
    ]);
    expect(JSON.parse(stdout)).toEqual({ resolved: 1, arrow: true, method: true });
  }, 60_000);
});
