// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PluginManager, type FarmPlugin } from "../plugin";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let fixtureRoot: string;
let pluginURL: string;

beforeAll(async () => {
  // Compile the checked-out source, not a possibly stale dist. Keeping the
  // fixture inside the package lets Node resolve its external dependencies.
  fixtureRoot = await fs.mkdtemp(path.join(packageRoot, ".tmp-plugin-parallel-"));
  const outfile = path.join(fixtureRoot, "plugin.mjs");
  await build({
    stdin: {
      contents: 'export { PluginManager } from "./src/plugin";',
      resolveDir: packageRoot,
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  pluginURL = pathToFileURL(outfile).href;
});

afterAll(async () => {
  if (fixtureRoot) {
    await fs.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

type ParallelHook = "init" | "beforeBundle" | "afterBundle" | "hmrUpdate";
type FailureMode = "sync" | "async" | "getter";

async function checkLateRejections(
  hook: ParallelHook,
  {
    grouped = false,
    mode = "sync",
    failure = "error",
    rejectBeforeDispatch = false,
  }: {
    grouped?: boolean;
    mode?: FailureMode;
    failure?: "error" | "null" | "undefined";
    rejectBeforeDispatch?: boolean;
  } = {},
) {
  // A separate Node process makes a dropped rejection fatal without installing
  // global handlers or interfering with Vitest's own rejection tracking.
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      "--unhandled-rejections=strict",
      "--input-type=module",
      "--eval",
      `
import assert from "node:assert/strict";
import { PluginManager } from ${JSON.stringify(pluginURL)};
const hook = ${JSON.stringify(hook)};
const grouped = ${grouped};
const mode = ${JSON.stringify(mode)};
const expected = ${failure === "error" ? 'new Error("synchronous dispatch failure")' : failure};
const manager = new PluginManager({ config: {}, isDev: true, isProd: false });
const first = Promise.withResolvers();
const second = Promise.withResolvers();
const makePlugin = (name, callback) => {
  if (!grouped) return { name, [hook]: callback };
  if (hook === "beforeBundle") return { name, build: { before: callback } };
  if (hook === "afterBundle") return { name, build: { after: callback } };
  return { name, dev: { update: callback } };
};
manager.addPlugin(makePlugin("first", () => first.promise));
manager.addPlugin(makePlugin("second", () => second.promise));
// Dispatch must remain fail-fast even if an earlier hook never settles.
manager.addPlugin(makePlugin("never", () => new Promise(() => {})));
const fail = () => { throw expected; };
manager.addPlugin(mode === "getter"
  ? { name: "broken", get [hook]() { throw expected; } }
  : makePlugin("broken", mode === "async" ? async () => fail() : fail));
let laterCalls = 0;
manager.addPlugin(makePlugin("later", () => { laterCalls++; }));
const rejectEarlier = () => {
  first.reject(new Error("first late rejection"));
  second.reject(new Error("second late rejection"));
};
if (${rejectBeforeDispatch}) rejectEarlier();
await assert.rejects(manager.runHookParallel(hook, { success: false }), error => error === expected);
assert.equal(laterCalls, mode === "async" ? 1 : 0);
if (!${rejectBeforeDispatch}) rejectEarlier();
// Cross an event-loop turn so Node has checked for unhandled rejections.
await new Promise(resolve => setImmediate(resolve));
console.log("handled");
`,
    ],
    { cwd: packageRoot, timeout: 20_000 },
  );
  expect(stdout.trim()).toBe("handled");
  expect(stderr).toBe("");
}

describe("parallel plugin hook failures", () => {
  it.each<ParallelHook>(["init", "beforeBundle", "afterBundle", "hmrUpdate"])(
    "observes earlier promises when %s throws synchronously",
    async (hook) => checkLateRejections(hook),
  );

  it.each<ParallelHook>(["beforeBundle", "afterBundle", "hmrUpdate"])(
    "observes earlier promises when the grouped %s hook throws",
    async (hook) => checkLateRejections(hook, { grouped: true }),
  );

  it("observes earlier promises when reading a later hook throws", async () => {
    await checkLateRejections("init", { mode: "getter" });
  });

  it("preserves the synchronous failure when earlier promises have already rejected", async () => {
    await checkLateRejections("init", { rejectBeforeDispatch: true });
  });

  it.each(["null", "undefined"] as const)(
    "preserves a thrown %s without stranding earlier promises",
    async (failure) => checkLateRejections("init", { failure }),
  );

  it.each<ParallelHook>(["init", "beforeBundle", "afterBundle", "hmrUpdate"])(
    "retains fail-fast asynchronous rejection handling for %s",
    async (hook) => checkLateRejections(hook, { mode: "async" }),
  );

  it("retains concurrent invocation, enforce order, filtering, context, and this", async () => {
    const manager = new PluginManager({ config: {}, isDev: false, isProd: true });
    const gate = Promise.withResolvers<void>();
    const calls: string[] = [];
    const plugin = (name: string, enforce?: "pre" | "post"): FarmPlugin => ({
      name,
      enforce,
      init(context) {
        expect(this.name).toBe(name);
        expect(context.isProd).toBe(true);
        calls.push(name);
        if (name === "pre") return gate.promise;
      },
    });
    manager.addPlugins([
      plugin("post", "post"),
      {
        name: "excluded",
        init() {
          throw new Error("must not run");
        },
      },
      plugin("normal"),
      plugin("pre", "pre"),
    ]);
    let settled = false;
    const running = manager
      .runHookParallelFiltered("init", (entry) => entry.name !== "excluded")
      .then((result) => {
        settled = true;
        return result;
      });
    try {
      expect(calls).toEqual(["pre", "normal", "post"]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      gate.resolve();
      await running;
    }
    expect(await running).toBe(false);
  });
});
