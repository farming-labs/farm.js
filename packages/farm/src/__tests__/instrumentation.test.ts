// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFarmInstrumentationLifecycle,
  loadFarmInstrumentation,
  resolveFarmInstrumentationFile,
  resolveFarmInstrumentationRuntime,
} from "../instrumentation";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-instrumentation-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("instrumentation convention", () => {
  it("discovers one source or root instrumentation file and rejects ambiguity", async () => {
    const root = await createTemporaryRoot();
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const sourceFile = path.join(root, "src", "instrumentation.ts");
    await fs.writeFile(sourceFile, "export function register() {}\n");
    expect(resolveFarmInstrumentationFile(root, "src")).toBe(sourceFile);

    await fs.writeFile(path.join(root, "instrumentation.mjs"), "export function register() {}\n");
    expect(() => resolveFarmInstrumentationFile(root, "src")).toThrow(
      "multiple instrumentation files",
    );
  });

  it("starts and shuts down once in deterministic order", async () => {
    const calls: string[] = [];
    const lifecycle = createFarmInstrumentationLifecycle(
      {
        async register(context) {
          calls.push(`register:${context.mode}:${context.runtime}`);
          return async () => calls.push("registered-cleanup");
        },
        async shutdown() {
          calls.push("module-shutdown");
        },
      },
      { root: "/app", mode: "production", runtime: "nodejs" },
    );

    await Promise.all([lifecycle.start(), lifecycle.start()]);
    await Promise.all([lifecycle.shutdown(), lifecycle.shutdown()]);
    expect(calls).toEqual(["register:production:nodejs", "registered-cleanup", "module-shutdown"]);
  });

  it("runs exported shutdown even when registered cleanup fails", async () => {
    const calls: string[] = [];
    const lifecycle = createFarmInstrumentationLifecycle(
      {
        register() {
          return () => {
            calls.push("registered-cleanup");
            throw new Error("cleanup failed");
          };
        },
        shutdown() {
          calls.push("module-shutdown");
        },
      },
      { root: "/app", mode: "production", runtime: "nodejs" },
    );

    await lifecycle.start();
    await expect(lifecycle.shutdown()).rejects.toThrow("cleanup failed");
    expect(calls).toEqual(["registered-cleanup", "module-shutdown"]);
  });

  it("loads and executes TypeScript instrumentation with local imports", async () => {
    const root = await createTemporaryRoot();
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "marker.ts"), `export const marker = "loaded";`);
    const filePath = path.join(root, "src", "instrumentation.ts");
    await fs.writeFile(
      filePath,
      `
import { marker } from "./marker";
export function register(context: { mode: string; runtime: string }) {
  globalThis.__farmInstrumentationTest = marker + ":" + context.mode + ":" + context.runtime;
}
`.trim(),
    );

    const module = await loadFarmInstrumentation(filePath, root);
    const lifecycle = createFarmInstrumentationLifecycle(module, {
      root,
      mode: "development",
      runtime: "nodejs",
    });
    await lifecycle.start();
    expect((globalThis as any).__farmInstrumentationTest).toBe("loaded:development:nodejs");
    delete (globalThis as any).__farmInstrumentationTest;
  });

  it("maps production presets to instrumentation runtimes", () => {
    expect(resolveFarmInstrumentationRuntime("node-server")).toBe("nodejs");
    expect(resolveFarmInstrumentationRuntime("vercel")).toBe("nodejs");
    expect(resolveFarmInstrumentationRuntime("cloudflare-pages")).toBe("edge");
    expect(resolveFarmInstrumentationRuntime("bun")).toBe("bun");
  });
});
