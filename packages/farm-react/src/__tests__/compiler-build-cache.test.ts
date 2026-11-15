// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as compiler from "../compiler";
import { ReactCompilerBuildCache, getReactCompilerBuildCache } from "../compiler-build-cache";
import { normalizeReactCompilerOptions, react } from "../index";
import { createFarmRendererPlugin } from "../vite";

const source = `import { useState } from 'react';
export function Counter() { const [n, setN] = useState(0);
return <button onClick={() => setN(n + 1)}>{n}</button>; }`;
const result = await compiler.compileReactModule(
  source,
  "/app/Counter.tsx",
  normalizeReactCompilerOptions(true),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("production compiler result ownership", () => {
  it("coalesces identical pending work and returns independent exact results", async () => {
    const cache = new ReactCompilerBuildCache();
    const work = deferred<compiler.CompileReactModuleResult>();
    const compile = vi.fn(() => work.promise);
    const first = cache.compile("a", compile);
    const second = cache.compile("a", compile);
    await Promise.resolve();
    expect(compile).toHaveBeenCalledTimes(1);
    work.resolve(result);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(result);
    expect(b).toEqual(result);
    expect(a).not.toBe(b);
    (a.compiled as string[]).push("mutated");
    (a.map as any).sources.push("mutated");
    a.optimizations.keyedArrayAppendHints = 999;
    expect(await cache.compile("a", compile)).toEqual(result);
    expect(b).toEqual(result);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(cache.retainedBytes).toBeGreaterThan(2);
  });

  it("evicts least recently used entries, including their retained byte count", async () => {
    const cache = new ReactCompilerBuildCache(1_000_000, 2);
    const compile = vi.fn(async () => result);
    for (const key of ["a", "b", "a", "c", "a", "b"]) await cache.compile(key, compile);
    expect(compile).toHaveBeenCalledTimes(4);
    expect(cache.size).toBe(2);
    const retained = cache.retainedBytes;
    expect(retained).toBeGreaterThan(0);
    await cache.compile("c", compile);
    expect(cache.retainedBytes).toBe(retained);
  });

  it("bounds result bytes and bypasses an oversized source key", async () => {
    const cache = new ReactCompilerBuildCache(10, 10);
    const compile = vi.fn(async () => result);
    await cache.compile("a", compile);
    expect(cache.size).toBe(0);
    expect(cache.retainedBytes).toBe(0);
    await cache.compile("a", compile);
    await cache.compile("oversized source", compile);
    expect(compile).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(0);
  });

  it("does not retain errors and permits a fresh retry", async () => {
    const cache = new ReactCompilerBuildCache();
    const error = new Error("compile failed");
    const compile = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(result);
    await expect(cache.compile("a", compile)).rejects.toBe(error);
    expect(cache.size).toBe(0);
    expect(cache.retainedBytes).toBe(0);
    expect(await cache.compile("a", compile)).toEqual(result);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "an evicted pending result cannot replace/delete a newer entry (reject=%s)",
    async (reject) => {
      const cache = new ReactCompilerBuildCache(1_000_000, 1);
      const work = deferred<compiler.CompileReactModuleResult>();
      const old = cache.compile("a", () => work.promise);
      const settled = Promise.allSettled([old]);
      await cache.compile("b", async () => result);
      const newer = { ...result, code: "newer result" };
      await cache.compile("a", async () => newer);
      if (reject) work.reject(new Error("old failure"));
      else work.resolve(result);
      await settled;
      const unexpectedCompile = vi.fn(async () => result);
      expect(await cache.compile("a", unexpectedCompile)).toEqual(newer);
      expect(unexpectedCompile).not.toHaveBeenCalled();
      expect(cache.size).toBe(1);
    },
  );

  it("disposes pending results without canceling their callers or repopulating the cache", async () => {
    const owner = new AbortController();
    const cache = getReactCompilerBuildCache(owner.signal)!;
    expect(getReactCompilerBuildCache(owner.signal)).toBe(cache);
    const work = deferred<compiler.CompileReactModuleResult>();
    const pending = cache.compile("a", () => work.promise);
    owner.abort();
    owner.abort();
    work.resolve(result);
    expect(await pending).toEqual(result);
    expect(cache.size).toBe(0);
    expect(cache.retainedBytes).toBe(0);
    expect(getReactCompilerBuildCache(owner.signal)).toBeUndefined();
    const compile = vi.fn(async () => result);
    await cache.compile("a", compile);
    expect(compile).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });
});

function plugin(
  lifetime?: AbortSignal,
  root = "/app",
  ssr = false,
  options: Parameters<typeof react>[0] = { compiler: true },
) {
  const [plugin] = createFarmRendererPlugin({
    buildLifetime: lifetime,
    ssr,
    rendererOptions: react(options).options,
  });
  const context = {
    warn: vi.fn(),
    error: (message: string) => {
      throw new Error(message);
    },
  };
  (plugin!.configResolved as Function)({ root });
  return {
    transform: (code = source, id = root + "/Counter.tsx") =>
      (plugin!.transform as Function).call(context, code, id),
    warn: context.warn,
    start: () => (plugin!.buildStart as Function).call(context),
    end: (error?: Error) => (plugin!.buildEnd as Function).call(context, error),
  };
}

describe("compiler plugin build scope", () => {
  it("collects cache-hit reports per client build, resets removed modules, and skips failed/SSR reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-compiler-cache-report-"));
    const owner = new AbortController();
    const spy = vi.spyOn(compiler, "compileReactModule");
    try {
      const options = { compiler: { report: true } } as const;
      const ssr = plugin(owner.signal, root, true, options);
      const client = plugin(owner.signal, root, false, options);
      await ssr.transform();
      await ssr.end();
      const reportPath = join(root, ".farm", "react-compiler.json");
      await expect(readFile(reportPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      client.start();
      await client.transform();
      await client.end();
      const report = await readFile(reportPath, "utf8");
      expect(JSON.parse(report).summary.compiled).toBe(1);
      client.start();
      await client.end();
      expect(JSON.parse(await readFile(reportPath, "utf8")).summary.compiled).toBe(0);
      client.start();
      await client.transform();
      await client.end();
      expect(await readFile(reportPath, "utf8")).toBe(report);
      client.start();
      await client.end(new Error("build failed"));
      expect(await readFile(reportPath, "utf8")).toBe(report);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      owner.abort();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses exact inputs across discovery/SSR/client plugins without sharing mutable maps", async () => {
    const spy = vi.spyOn(compiler, "compileReactModule");
    const owner = new AbortController();
    const plugins = [
      plugin(owner.signal, "/app", true),
      plugin(owner.signal),
      plugin(owner.signal, "/app", true),
    ];
    const outputs = await Promise.all(plugins.map((p) => p.transform()));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outputs[0]).toEqual({ code: result.code, map: result.map });
    expect(outputs[1]).toEqual(outputs[0]);
    outputs[0].map.sources.push("changed");
    expect(outputs[1].map).toEqual(result.map);
    owner.abort();
  });

  it("isolates concurrent builds and bypasses ordinary dev, disabled and disposed builds", async () => {
    const spy = vi.spyOn(compiler, "compileReactModule");
    const first = new AbortController(),
      second = new AbortController();
    const a = plugin(first.signal),
      b = plugin(second.signal),
      dev = plugin();
    await Promise.all([a.transform(), b.transform(), dev.transform()]);
    await Promise.all([a.transform(), b.transform(), dev.transform()]);
    expect(spy).toHaveBeenCalledTimes(4);
    const disabled = new AbortController();
    const listener = vi.spyOn(disabled.signal, "addEventListener");
    expect(createFarmRendererPlugin({ buildLifetime: disabled.signal })).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    first.abort();
    await a.transform();
    await a.transform();
    expect(spy).toHaveBeenCalledTimes(6);
    second.abort();
  });

  it("keys source edits, filenames, project roots, normalized options and compiler environment", async () => {
    const spy = vi.spyOn(compiler, "compileReactModule");
    const owner = new AbortController();
    const a = plugin(owner.signal);
    await a.transform();
    await a.transform(source + "\n// edited");
    await a.transform(source, "/app/Renamed.tsx");
    await plugin(owner.signal, "/other").transform();
    await plugin(owner.signal, "/app", false, { compiler: { reactivity: "static" } }).transform();
    vi.stubEnv("BABEL_ENV", "cache-test");
    await a.transform();
    vi.unstubAllEnvs();
    await a.transform();
    expect(spy).toHaveBeenCalledTimes(6);
    // Removal/ineligible files do not read the store; recreation must still
    // supply the exact source. A rename has its own HMR/source-map identity.
    expect(await a.transform(source, "/app/Counter.ts")).toBeNull();
    owner.abort();
  });

  it("preserves drive-prefixed filenames and queries' existing module identity", async () => {
    const spy = vi.spyOn(compiler, "compileReactModule");
    const owner = new AbortController();
    const a = plugin(owner.signal, "C:/app");
    // Vite accepts native backslashes on Windows; on POSIX backslashes are
    // literal filename characters, so exercise its normalized module IDs.
    const id =
      process.platform === "win32" ? "C:\\app\\Counter.tsx?import" : "C:/app/Counter.tsx?import";
    const first = await a.transform(source, id);
    expect(first).not.toBeNull();
    expect(await a.transform(source, "C:/app/Counter.tsx")).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    owner.abort();
  });

  it.each(["warn", "error"] as const)(
    "delivers %s diagnostics on every invocation including hits",
    async (onUnsupported) => {
      const spy = vi.spyOn(compiler, "compileReactModule");
      const owner = new AbortController();
      const a = plugin(owner.signal, "/app", false, { compiler: { onUnsupported } });
      const unsupported = `import {useEffect} from 'react'; export function Bad(){useEffect(()=>{},[]);return <p/>;}`;
      for (let i = 0; i < 2; i++) {
        if (onUnsupported === "error")
          await expect(a.transform(unsupported)).rejects.toThrow(/using React/);
        else expect(await a.transform(unsupported)).toBeNull();
      }
      expect(spy).toHaveBeenCalledTimes(1);
      expect(a.warn).toHaveBeenCalledTimes(onUnsupported === "warn" ? 2 : 0);
      owner.abort();
    },
  );
});
