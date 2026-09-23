import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateClientCachePersistenceCode,
  resolveFarmClientCacheAdapterEntry,
} from "../client-cache-persistence-build";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-cache-adapter-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveFarmClientCacheAdapterEntry", () => {
  it("returns undefined when persistence is not configured", () => {
    expect(resolveFarmClientCacheAdapterEntry(root, undefined)).toBeUndefined();
    expect(resolveFarmClientCacheAdapterEntry(root, {})).toBeUndefined();
    expect(resolveFarmClientCacheAdapterEntry(root, { client: {} })).toBeUndefined();
  });

  it("resolves an extensionless module path against the project root", () => {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "cache-adapter.ts"), "export default {};\n");

    const entry = resolveFarmClientCacheAdapterEntry(root, {
      client: { adapter: "./src/cache-adapter", version: "build-7", flushDelayMs: 100 },
    });

    expect(entry?.importPath.endsWith("src/cache-adapter.ts")).toBe(true);
    expect(entry?.importPath.includes("\\")).toBe(false);
    expect(entry?.options).toEqual({ version: "build-7", flushDelayMs: 100 });
  });

  it("accepts an explicit file path", () => {
    fs.writeFileSync(path.join(root, "adapter.mjs"), "export default {};\n");
    const entry = resolveFarmClientCacheAdapterEntry(root, {
      client: { adapter: "adapter.mjs" },
    });
    expect(entry?.importPath.endsWith("adapter.mjs")).toBe(true);
    expect(entry?.options).toEqual({});
  });

  it("fails the build with an actionable error for a missing module", () => {
    expect(() =>
      resolveFarmClientCacheAdapterEntry(root, { client: { adapter: "./src/missing" } }),
    ).toThrow(/cache\.client\.adapter was not found: \.\/src\/missing/);
  });

  it("rejects non-string adapter values", () => {
    expect(() =>
      resolveFarmClientCacheAdapterEntry(root, {
        client: { adapter: {} as unknown as string },
      }),
    ).toThrow(/module path string/);
  });
});

describe("generateClientCachePersistenceCode", () => {
  it("emits empty fragments when not configured", () => {
    expect(generateClientCachePersistenceCode(undefined)).toEqual({ imports: "", init: "" });
  });

  it("emits an adapter import and an init call with the serialized options", () => {
    const code = generateClientCachePersistenceCode({
      importPath: "/app/src/cache-adapter.ts",
      options: { version: "build-7" },
    });

    expect(code.imports).toContain('from "/app/src/cache-adapter.ts"');
    expect(code.imports).toContain("initConfiguredClientCachePersistence");
    expect(code.imports).toContain('"@farm.js/core/client"');
    expect(code.init).toContain('{"version":"build-7"}');
  });
});

describe("generated entry contract", () => {
  it("imports a symbol the client entry point actually exports", async () => {
    const code = generateClientCachePersistenceCode({
      importPath: "/app/src/cache-adapter.ts",
      options: {},
    });

    // The generated entry renames this import locally, so a missing export is
    // only discovered when an app boots. Pin the contract here instead: every
    // app configuring cache.client.adapter fails to load without it.
    const imported = code.imports.match(/import \{ (\w+) as/)?.[1];
    expect(imported).toBe("initConfiguredClientCachePersistence");

    const clientEntry = await import("../client");
    expect(typeof (clientEntry as Record<string, unknown>)[imported!]).toBe("function");
  });
});
