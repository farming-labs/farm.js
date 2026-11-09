// @vitest-environment node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Rollup } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { collectServerFileSSRAssets, collectServerOnlySSRAssets } from "../nitro/ssr-public-assets";
import { definePlugin } from "../plugin";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

/** `(module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))` */
const ADD_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function writeModule(
  root: string,
  relativePath: string,
  source: string | Uint8Array,
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

/** An app whose API route imports a local WebAssembly module without the `@farm.js/wasm` plugin. */
async function createServerWasmFixture(): Promise<string> {
  // Inside the package so the page fixture resolves React through the workspace.
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-ssr-public-assets-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(root, "src/wasm/math.wasm", ADD_WASM);
  await writeModule(root, "src/wasm/math.ts", `export { add } from "./math.wasm";`);
  await writeModule(
    root,
    "src/app/api/add/route.ts",
    `import { add } from "../../../wasm/math";

export function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json({ sum: add(Number(url.searchParams.get("a")), Number(url.searchParams.get("b"))) });
}`,
  );
  return root;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

async function listRelativeFiles(directory: string): Promise<string[]> {
  return (await listFiles(directory)).map((file) =>
    path.relative(directory, file).split(path.sep).join("/"),
  );
}

async function withProductionServer(
  serverDir: string,
  run: (origin: string) => Promise<void>,
  command = process.execPath,
): Promise<void> {
  const port = await getAvailablePort();
  const processOutput: string[] = [];
  const productionServer = spawn(command, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  productionServer.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
  productionServer.stderr.on("data", (chunk) => processOutput.push(String(chunk)));
  const exited = new Promise<void>((resolve) => productionServer.once("exit", () => resolve()));

  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt++) {
      if (productionServer.exitCode !== null) break;
      ready = await fetch(`${origin}/_farm/health/ready`).then(
        (response) => response.ok,
        () => false,
      );
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready, processOutput.join("")).toBe(true);
    await run(origin);
  } finally {
    if (productionServer.exitCode === null) productionServer.kill();
    await exited;
  }
}

describe("SSR assets in the public output", () => {
  it("keeps an asset only server code reads out of the public output", async () => {
    const root = await createServerWasmFixture();
    // A copy an earlier build published; without a client build nothing else clears it.
    await writeModule(root, ".farm/client/assets/math-earlier.wasm", ADD_WASM);
    const config = await resolveConfig({ root, renderer: false }, "production");
    await build(config, { root, preset: "node-server" });

    const output = path.join(root, ".farm", ".output");
    const serverFiles = await listRelativeFiles(path.join(output, "server"));
    const wasmFile = serverFiles.find((file) => /^farm-ssr\/assets\/math-[\w-]+\.wasm$/.test(file));
    expect(wasmFile, serverFiles.join("\n")).toBeDefined();
    const wasmUrl = `/${wasmFile!.slice("farm-ssr/".length)}`;

    await withProductionServer(path.join(output, "server"), async (origin) => {
      // The route still loads the binary, from beside the server bundle.
      const sum = await fetch(`${origin}/api/add?a=20&b=22`);
      expect(sum.status).toBe(200);
      await expect(sum.json()).resolves.toEqual({ sum: 42 });

      const asset = await fetch(`${origin}${wasmUrl}`);
      expect(asset.status).toBe(404);
      expect(asset.headers.get("content-type")).not.toBe("application/wasm");
      await asset.body?.cancel();
    });

    // Nor is it left in the public output for a static host or CDN to upload.
    const publicFiles = await listRelativeFiles(path.join(output, "public"));
    expect(publicFiles.filter((file) => file.endsWith(".wasm"))).toEqual([]);
    expect(await listRelativeFiles(path.join(root, ".farm", "client"))).not.toContain(
      wasmUrl.slice(1),
    );
  }, 180_000);

  it("keeps serving the assets a server-rendered page references", async () => {
    const root = await createServerWasmFixture();
    await writeModule(root, "src/app/logo.png", ONE_PIXEL_PNG);
    await writeModule(root, "src/app/font.woff2", "font bytes");
    await writeModule(root, "src/app/marker.txt", "page marker");
    await writeModule(
      root,
      "src/app/globals.css",
      `@font-face { font-family: Probe; src: url("./font.woff2") format("woff2"); }
body { font-family: Probe; }`,
    );
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import "./globals.css";

export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}`,
    );
    // The page links the same binary the API route reads, so the browser may request it.
    await writeModule(
      root,
      "src/app/page.tsx",
      `import markerUrl from "./marker.txt?url";
import logoUrl from "./logo.png?url";
import wasmUrl from "../wasm/math.wasm?url";

export default function Page() {
  return (
    <main>
      <img src={logoUrl} alt="" />
      <a data-marker href={markerUrl}>marker</a>
      <a data-wasm href={wasmUrl}>wasm</a>
    </main>
  );
}`,
    );

    const config = await resolveConfig({ root }, "production");
    await build(config, { root, preset: "node-server" });

    const output = path.join(root, ".farm", ".output");
    const publicFiles = await listRelativeFiles(path.join(output, "public"));
    const ssrStylesheets = (
      await listRelativeFiles(path.join(output, "server", "farm-ssr"))
    ).filter((file) => file.endsWith(".css"));
    expect(ssrStylesheets.length).toBeGreaterThan(0);

    await withProductionServer(path.join(output, "server"), async (origin) => {
      const page = await fetch(`${origin}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      const referenced = [
        ...new Set(
          Array.from(
            html.matchAll(/(?:src|href)="(\/assets\/(?:logo|marker|math)-[^"]+)"/g),
            (match) => match[1],
          ),
        ),
      ];
      expect(referenced.map((url) => url.match(/^\/assets\/(\w+)-/)?.[1]).sort()).toEqual([
        "logo",
        "marker",
        "math",
      ]);

      for (const url of referenced) {
        expect(publicFiles).toContain(url.slice(1));
        const asset = await fetch(`${origin}${url}`);
        expect(asset.status, url).toBe(200);
        await asset.body?.cancel();
      }

      // The server graph's stylesheet and the font it points at stay public too.
      for (const stylesheet of ssrStylesheets) {
        expect(publicFiles).toContain(stylesheet);
        const css = await fetch(`${origin}/${stylesheet}`);
        expect(css.status).toBe(200);
        const fontUrl = (await css.text()).match(/url\((\/assets\/font-[^)]+\.woff2)\)/)?.[1];
        expect(fontUrl).toBeDefined();
        expect((await fetch(`${origin}${fontUrl}`)).status).toBe(200);
      }

      const sum = await fetch(`${origin}/api/add?a=1&b=2`);
      await expect(sum.json()).resolves.toEqual({ sum: 3 });
    });
  }, 240_000);
});

/** The server-read binary's path relative to the server directory, from the SSR bundle. */
async function findSSRWasmAsset(root: string): Promise<string> {
  const ssrFiles = await listRelativeFiles(path.join(root, ".farm", "ssr"));
  const wasmFile = ssrFiles.find((file) => /^assets\/math-[\w-]+\.wasm$/.test(file));
  expect(wasmFile, ssrFiles.join("\n")).toBeDefined();
  return wasmFile!;
}

/** Forces node-server onto Nitro's rebundle of `.farm/ssr`, as any late Nitro hook does. */
const nitroRebundlePlugin = definePlugin({
  name: "test:nitro-rebundle",
  build: {
    configure(nitroConfig) {
      return { ...nitroConfig, hooks: { ...nitroConfig.hooks, "rollup:before"() {} } };
    },
  },
});

describe("SSR assets server code reads in rebundled server output", () => {
  it("copies the asset beside the node-server fallback's rebundled server", async () => {
    const root = await createServerWasmFixture();
    const config = await resolveConfig(
      { root, renderer: false, plugins: [nitroRebundlePlugin] },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const serverDir = path.join(root, ".farm", ".output", "server");
    const serverFiles = await listRelativeFiles(serverDir);
    // Nitro rebundled the SSR graph rather than reusing Farm's prebuilt copy.
    expect(serverFiles.some((file) => file.startsWith("farm-ssr/"))).toBe(false);
    const wasmFile = await findSSRWasmAsset(root);
    expect(serverFiles).toContain(wasmFile);

    await withProductionServer(serverDir, async (origin) => {
      const sum = await fetch(`${origin}/api/add?a=20&b=22`);
      expect(sum.status).toBe(200);
      await expect(sum.json()).resolves.toEqual({ sum: 42 });
      // Still server-private: the copy is not a public asset.
      const asset = await fetch(`${origin}/${wasmFile}`);
      expect(asset.status).toBe(404);
      await asset.body?.cancel();
    });
  }, 180_000);

  it("copies the asset beside the bun server", async ({ skip }) => {
    const root = await createServerWasmFixture();
    const config = await resolveConfig({ root, renderer: false }, "production");
    await build(config, { root, preset: "bun" });

    const serverDir = path.join(root, ".farm", ".output", "server");
    const wasmFile = await findSSRWasmAsset(root);
    expect(await listRelativeFiles(serverDir)).toContain(wasmFile);
    expect(
      (await listRelativeFiles(path.join(root, ".farm", ".output", "public"))).filter((file) =>
        file.endsWith(".wasm"),
      ),
    ).toEqual([]);

    if (!hasBun) skip();
    // Before the copy, the server crashed at startup with ENOENT for server/assets/math-*.wasm.
    await withProductionServer(
      serverDir,
      async (origin) => {
        const sum = await fetch(`${origin}/api/add?a=40&b=2`);
        expect(sum.status).toBe(200);
        await expect(sum.json()).resolves.toEqual({ sum: 42 });
      },
      "bun",
    );
  }, 180_000);

  it("copies the asset into the Vercel function", async () => {
    const root = await createServerWasmFixture();
    const config = await resolveConfig({ root, renderer: false }, "production");
    await build(config, { root, preset: "vercel" });

    const output = path.join(root, ".vercel", "output");
    const functionDir = path.join(output, "functions", "__nitro.func");
    expect(await listRelativeFiles(functionDir)).toContain(await findSSRWasmAsset(root));
    expect(
      (await listRelativeFiles(path.join(output, "static"))).filter((file) =>
        file.endsWith(".wasm"),
      ),
    ).toEqual([]);

    const entry = pathToFileURL(path.join(functionDir, "index.mjs")).href;
    const server = (await import(/* @vite-ignore */ entry)).default;
    const response: Response = await server.fetch(
      new Request("https://farm.test/api/add?a=19&b=23"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sum: 42 });
  }, 180_000);

  it("copies the asset into the Netlify function", async () => {
    const root = await createServerWasmFixture();
    const config = await resolveConfig({ root, renderer: false }, "production");
    await build(config, { root, preset: "netlify" });

    const functionDir = path.join(root, ".netlify", "functions-internal", "server");
    expect(await listRelativeFiles(functionDir)).toContain(await findSSRWasmAsset(root));

    const entry = pathToFileURL(path.join(functionDir, "main.mjs")).href;
    const { default: handler } = await import(/* @vite-ignore */ entry);
    const response: Response = await handler(
      new Request("https://site.netlify.app/api/add?a=21&b=21"),
      {},
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sum: 42 });
  }, 180_000);

  it("fails a Cloudflare Worker build that would read the asset from disk", async () => {
    const root = await createServerWasmFixture();
    const config = await resolveConfig({ root, renderer: false }, "production");
    const failure = await build(config, { root, preset: "cloudflare-module" }).then(
      () => null,
      (error: Error) => error,
    );

    expect(failure?.message).toMatch(
      /The cloudflare-module preset cannot deploy files that server code reads from disk: assets\/math-[\w-]+\.wasm\./,
    );
    expect(failure?.message).toContain("refuse to compile WebAssembly from bytes");
    expect(failure?.message).toContain("node-server, bun, vercel, or netlify");
    // No Worker that would crash at startup is left to deploy.
    await expect(
      fs.access(path.join(root, ".farm", ".output", "server", "index.mjs")),
    ).rejects.toThrow();
  }, 180_000);
});

function chunk(fileName: string, code: string): Rollup.OutputChunk {
  return { type: "chunk", fileName, code } as Rollup.OutputChunk;
}

function asset(fileName: string, source: string | Uint8Array = ""): Rollup.OutputAsset {
  return { type: "asset", fileName, source } as Rollup.OutputAsset;
}

function bundleOf(...outputs: Array<Rollup.OutputChunk | Rollup.OutputAsset>): Rollup.OutputBundle {
  return Object.fromEntries(outputs.map((output) => [output.fileName, output]));
}

describe("collectServerFileSSRAssets", () => {
  it("includes an asset server code reads even when a page also links it", () => {
    const bundle = bundleOf(
      chunk(
        "entry.js",
        `const a = new URL("assets/linked-abc.wasm", import.meta.url);
const b = new URL("assets/private-def.wasm", import.meta.url);
const href = "/assets/linked-abc.wasm";
const page = "/assets/page-ghi.png";`,
      ),
      asset("assets/linked-abc.wasm"),
      asset("assets/private-def.wasm"),
      asset("assets/page-ghi.png"),
    );
    expect([...collectServerFileSSRAssets(bundle)].sort()).toEqual([
      "assets/linked-abc.wasm",
      "assets/private-def.wasm",
    ]);
    expect([...collectServerOnlySSRAssets(bundle)]).toEqual(["assets/private-def.wasm"]);
  });
});

describe("collectServerOnlySSRAssets", () => {
  it("treats an asset reached only through server file URLs as server-only", () => {
    const bundle = bundleOf(
      chunk("entry.js", `const url = new URL("assets/math-abc.wasm", import.meta.url).href;`),
      chunk("chunks/route.js", "const init = new URL('../assets/init-def.wasm', import.meta.url);"),
      chunk("chunks/minified.js", "x=new URL(`../assets/data-ghi.bin`,import.meta.url)"),
      asset("assets/math-abc.wasm"),
      asset("assets/init-def.wasm"),
      asset("assets/data-ghi.bin"),
    );
    expect([...collectServerOnlySSRAssets(bundle)].sort()).toEqual([
      "assets/data-ghi.bin",
      "assets/init-def.wasm",
      "assets/math-abc.wasm",
    ]);
  });

  it("keeps an asset public when anything else in the bundle references it", () => {
    const bundle = bundleOf(
      chunk(
        "entry.js",
        `const a = new URL("assets/linked-abc.wasm", import.meta.url);
const b = new URL("assets/styled-def.png", import.meta.url);
const href = "/assets/linked-abc.wasm";`,
      ),
      asset("assets/linked-abc.wasm"),
      asset("assets/styled-def.png"),
      asset("assets/page-ghi.css", "body{background:url(/assets/styled-def.png)}"),
      asset("assets/unreferenced-jkl.txt", "unreferenced"),
      asset("assets/url-mno.txt"),
    );
    expect(collectServerOnlySSRAssets(bundle).size).toBe(0);
  });

  it("ignores file URLs that do not name an emitted asset", () => {
    const bundle = bundleOf(
      chunk(
        "entry.js",
        `new URL("./other.js", import.meta.url);
new URL("../outside/secret.txt", import.meta.url);
new URL("/assets/absolute-abc.txt", import.meta.url);`,
      ),
      chunk("other.js", ""),
      asset("assets/absolute-abc.txt"),
    );
    expect(collectServerOnlySSRAssets(bundle).size).toBe(0);
  });
});
