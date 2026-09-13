import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build, createServer, type UserConfig } from "vite";
import wabt from "wabt";
import { wasm } from "./index.js";
import { resolveWasmOptions } from "./config.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function configure(options = {}, vite: UserConfig = {}) {
  const plugin = wasm(options);
  const result = plugin.configure!({ plugins: [plugin], vite } as never, {} as never);
  return (result as { vite: UserConfig }).vite;
}

async function fixture() {
  const root = await mkdtemp(path.join(process.cwd(), ".wasm-test-"));
  roots.push(root);
  const compiler = await wabt();
  const module = compiler.parseWat(
    "math.wat",
    '(module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))',
  );
  try {
    await writeFile(path.join(root, "math.wasm"), module.toBinary({}).buffer);
  } finally {
    module.destroy();
  }
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(path.join(root, "math.ts"), 'export { add } from "./math.wasm";');
  await writeFile(
    path.join(root, "worker.ts"),
    'import { add } from "./math.ts"; self.onmessage = () => self.postMessage(add(20, 22));',
  );
  await writeFile(
    path.join(root, "entry.ts"),
    `
    import { add } from "./math.ts";
    globalThis.answer = add(20, 22);
    globalThis.run = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    globalThis.lazy = () => import("./math.ts").then(({ add }) => add(1, 2));
  `,
  );
  return root;
}

describe("wasm options", () => {
  it("accepts browser targets without sharing mutable arrays", () => {
    expect(resolveWasmOptions({})).toEqual({});
    const target = ["es2022"];
    expect(resolveWasmOptions({ target })).toEqual({ target });
    expect(resolveWasmOptions({ target }).target).not.toBe(target);
  });

  it.each([null, [], true, { target: true }, { target: [] }, { target: " " }, { enabled: false }])(
    "rejects invalid options %j",
    (options) => {
      expect(() => wasm(options as never)).toThrow("[farm:wasm]");
    },
  );

  it("rejects duplicate Farm plugin registration", () => {
    const plugin = wasm();
    expect(() => plugin.configure!({ plugins: [plugin, wasm()] } as never, {} as never)).toThrow(
      "one wasm()",
    );
  });
});

describe("Vite configuration", () => {
  it("preserves app config without mutating it", () => {
    const existing = { name: "existing" };
    const original = { plugins: [existing], define: { __APP__: "true" } };
    const configured = configure({}, original);
    expect(configured.define).toEqual(original.define);
    expect(configured.plugins?.map((p: any) => p.name)).toEqual([
      "farm:wasm-workers",
      "vite-plugin-wasm",
      "existing",
    ]);
    expect(original.plugins).toEqual([existing]);
  });

  it("creates fresh worker plugins and preserves the factory arguments", () => {
    const existing = { name: "worker-existing" };
    const factory = vi.fn(() => [existing]);
    const configured = configure({}, { worker: { plugins: factory, format: "es" } });
    const hook = (configured.plugins![0] as any).config;
    // Production builds may supply only the Vite plugins, not the original worker config.
    const result = hook({}, { command: "serve" });
    const chain = ["entry.ts", "worker.ts"];
    const first = result.worker.plugins(chain);
    const second = result.worker.plugins(chain);
    expect(result.worker.format).toBe("es");
    expect(first.map((p: any) => p.name)).toEqual(["vite-plugin-wasm", "worker-existing"]);
    expect(first[0]).not.toBe(second[0]);
    expect(factory).toHaveBeenCalledWith(chain);
  });

  it("preserves legacy worker plugin arrays and final Vite overrides", () => {
    const configured = configure({}, { worker: { plugins: [{ name: "legacy" }] as never } });
    const hook = (configured.plugins![0] as any).config;
    expect(hook({}, { command: "serve" }).worker.plugins().at(-1).name).toBe("legacy");
    expect(
      hook({ worker: { plugins: () => [{ name: "override" }] } }, { command: "serve" })
        .worker.plugins()
        .at(-1).name,
    ).toBe("override");
  });

  it("uses module workers and does not change the server target", () => {
    const configured = configure({ target: "es2022" });
    expect(configured.plugins?.map((p: any) => p.name)).toEqual([
      "farm:wasm-workers",
      "vite-plugin-wasm",
    ]);
    expect(configured.build).toBeUndefined();
    const hook = (configured.plugins![0] as any).config;
    expect(hook({}, { command: "serve" }).worker.format).toBe("es");
    const browser = { build: { target: ["es2020"] } };
    hook(browser, { command: "build" });
    expect(browser.build.target).toBe("es2022");
    expect(hook({ build: { ssr: true } }, { command: "build" }).build).toBeUndefined();
    expect(() => hook({ worker: { format: "iife" } }, { command: "serve" })).toThrow(
      'worker.format: "es"',
    );
  });

  it("uses the app target when supplied and a modern default otherwise", () => {
    const hook = (configure({}, { build: { target: "esnext" } }).plugins![0] as any).config;
    const browser: any = {};
    hook(browser, { command: "build" });
    expect(browser.build.target).toBe("esnext");
    (configure().plugins![0] as any).config(browser, { command: "build" });
    expect(browser.build.target).toEqual(["chrome89", "edge89", "firefox114", "safari15"]);
  });
});

describe("real WebAssembly builds", () => {
  it("serves the loader helper through Vite's virtual-module URL in development", async () => {
    const root = await fixture();
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: configure().plugins,
      css: { postcss: { plugins: [] } },
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const module = await server.transformRequest("/math.wasm");
      expect(module?.code).toContain("/@id/__x00__/__vite-plugin-wasm-helper");
      // Vite's HTTP middleware unwraps /@id/__x00__ before transformRequest.
      const helper = await server.transformRequest("\0/__vite-plugin-wasm-helper");
      expect(helper?.code).toContain("WebAssembly.instantiate");
    } finally {
      await server.close();
    }
  });

  it("leaves Vite's explicit URL and init imports working", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "explicit.ts"),
      'import url from "./math.wasm?url"; import init from "./math.wasm?init"; globalThis.wasm = { url, init };',
    );
    const result = (await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: configure().plugins,
      css: { postcss: { plugins: [] } },
      build: {
        write: false,
        assetsInlineLimit: 0,
        rollupOptions: { input: path.join(root, "explicit.ts") },
      },
    })) as any;
    expect(result.output.some((file: any) => file.fileName.endsWith(".wasm"))).toBe(true);
  });

  it("rejects invalid binaries and explicitly incompatible targets", async () => {
    const root = await fixture();
    const options = {
      configFile: false as const,
      root,
      logLevel: "silent" as const,
      css: { postcss: { plugins: [] } },
      build: { write: false, rollupOptions: { input: path.join(root, "math.ts") } },
    };
    await expect(
      build({ ...options, plugins: configure({ target: "es2020" }).plugins }),
    ).rejects.toThrow(/Top-level await/);
    await writeFile(path.join(root, "math.wasm"), "not a wasm binary");
    await expect(build({ ...options, plugins: configure().plugins })).rejects.toThrow(
      /WebAssembly|wasm|magic/i,
    );
  });

  it("builds browser and worker Wasm with an encoded base path and preserves worker transforms", async () => {
    const root = await fixture();
    const marker = {
      name: "worker-marker",
      transform(code: string, id: string) {
        if (id.endsWith("/worker.ts")) return `self.workerMarker = "kept";\n${code}`;
      },
    };
    const configured = configure({}, { worker: { plugins: () => [marker] } });
    const result = (await build({
      configFile: false,
      root,
      logLevel: "silent",
      base: "/tools%20demo/",
      plugins: configured.plugins,
      css: { postcss: { plugins: [] } },
      build: {
        write: false,
        minify: false,
        target: "es2020",
        assetsInlineLimit: 0,
        rollupOptions: { input: path.join(root, "entry.ts") },
      },
    })) as any;
    expect(result.output.filter((file: any) => file.fileName.endsWith(".wasm"))).toHaveLength(1);
    const scripts = result.output
      .filter((file: any) => file.type === "chunk")
      .map((file: any) => file.code)
      .join("\n");
    expect(scripts).toContain("/tools%20demo/assets/");
    expect(scripts).toContain("await");
    const worker = result.output.find((file: any) => /worker-.*\.js$/.test(file.fileName));
    expect(String(worker.source ?? worker.code)).toContain("workerMarker");
  });

  it("executes an SSR transform of a real binary without fetching browser assets", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "server.ts"),
      'import { add } from "./math.wasm"; export const answer = add(20, 22);',
    );
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: configure().plugins,
      css: { postcss: { plugins: [] } },
      build: {
        ssr: path.join(root, "server.ts"),
        target: "node18",
        outDir: "output",
        minify: false,
        rollupOptions: { output: { entryFileNames: "server.js" } },
      },
    });
    const source = await readFile(path.join(root, "output/server.js"), "utf8");
    const module = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    expect(module.answer).toBe(42);
  });

  it("fails for raw Wasm imports without the plugin", async () => {
    const root = await fixture();
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        css: { postcss: { plugins: [] } },
        build: { write: false, rollupOptions: { input: path.join(root, "entry.ts") } },
      }),
    ).rejects.toThrow(/WASM|WebAssembly|wasm/);
  });
});
