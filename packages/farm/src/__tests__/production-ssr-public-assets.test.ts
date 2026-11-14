// @vitest-environment node

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Rollup } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { definePlugin } from "../plugin";
import { collectServerOnlySSRAssets, collectServerReadSSRAssets } from "../nitro/ssr-public-assets";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();

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

/**
 * An app whose API route imports a local WebAssembly module without the `@farm.js/wasm` plugin.
 * A `lazy` route imports it on request, so the code reading the binary sits in a nested chunk.
 */
async function createServerWasmFixture({ lazy = false } = {}): Promise<string> {
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
    lazy
      ? `export async function GET(request: Request) {
  const { add } = await import("../../../wasm/math");
  const url = new URL(request.url);
  return Response.json({ sum: add(Number(url.searchParams.get("a")), Number(url.searchParams.get("b"))) });
}`
      : `import { add } from "../../../wasm/math";

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
  const productionServer = await startProductionServer(serverDir, { command });
  try {
    await run(productionServer.origin);
  } finally {
    await productionServer.stop();
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

// Bun is optional: without it the bun output's layout is still checked, but not run.
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

/** Import a built serverless function in a fresh Node process and send it one request. */
function requestFunctionModule(
  modulePath: string,
  url: string,
): Promise<{ status: number; body: string }> {
  const script = `
const { default: handler } = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
const request = new Request(${JSON.stringify(url)});
const context = { waitUntil() {} };
const response =
  typeof handler === "function" ? await handler(request, context) : await handler.fetch(request, context);
process.stdout.write(JSON.stringify({ status: response.status, body: await response.text() }));
process.exit(0);
`;
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: path.dirname(modulePath) },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stderr}`));
        else resolve(JSON.parse(stdout));
      },
    );
  });
}

async function expectServerReadsWasm(serverDir: string): Promise<void> {
  const serverFiles = await listRelativeFiles(serverDir);
  expect(
    serverFiles.filter((file) => file.endsWith(".wasm")),
    serverFiles.join("\n"),
  ).toEqual([expect.stringMatching(/^assets\/math-[\w-]+\.wasm$/)]);
}

describe("SSR assets server code reads, once Nitro rebundles the server", () => {
  it.for([
    { preset: "bun", serverDir: ".farm/.output/server", entry: "index.mjs" },
    { preset: "vercel", serverDir: ".vercel/output/functions/__nitro.func", entry: "index.mjs" },
    { preset: "netlify", serverDir: ".netlify/functions-internal/server", entry: "main.mjs" },
  ])(
    "deploys the binary with the $preset server code",
    async ({ preset, serverDir, entry }) => {
      const root = await createServerWasmFixture({ lazy: true });
      const config = await resolveConfig({ root, renderer: false }, "production");
      await build(config, { root, preset });

      const serverOutput = path.join(root, serverDir);
      await expectServerReadsWasm(serverOutput);
      expect(
        (await listRelativeFiles(path.join(root, ".farm", "client"))).filter((file) =>
          file.endsWith(".wasm"),
        ),
      ).toEqual([]);

      if (preset === "bun") {
        if (!hasBun) return;
        await withProductionServer(
          serverOutput,
          async (origin) => {
            const sum = await fetch(`${origin}/api/add?a=20&b=22`);
            expect(sum.status).toBe(200);
            await expect(sum.json()).resolves.toEqual({ sum: 42 });
          },
          "bun",
        );
        return;
      }
      const response = await requestFunctionModule(
        path.join(serverOutput, entry),
        "http://localhost/api/add?a=20&b=22",
      );
      expect(response, response.body).toEqual({ status: 200, body: '{"sum":42}' });
    },
    180_000,
  );

  it("deploys the binary with a node-server build Nitro bundles", async () => {
    const root = await createServerWasmFixture({ lazy: true });
    const config = await resolveConfig(
      {
        root,
        renderer: false,
        plugins: [
          definePlugin({
            name: "custom-rollup-plugin",
            build: {
              // Any Rollup plugin keeps Nitro bundling the SSR output instead of reusing it.
              configure: (nitroConfig) => ({
                ...nitroConfig,
                rollupConfig: {
                  ...nitroConfig.rollupConfig,
                  plugins: [{ name: "custom-rollup-plugin" }],
                },
              }),
            },
          }),
        ],
      },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const serverDir = path.join(root, ".farm", ".output", "server");
    await expect(fs.access(path.join(serverDir, "farm-ssr"))).rejects.toThrow();
    await expectServerReadsWasm(serverDir);
    await withProductionServer(serverDir, async (origin) => {
      const sum = await fetch(`${origin}/api/add?a=20&b=22`);
      expect(sum.status).toBe(200);
      await expect(sum.json()).resolves.toEqual({ sum: 42 });
    });
  }, 180_000);

  it("fails a Cloudflare Workers build that would read the binary at runtime", async () => {
    const root = await createServerWasmFixture();
    const config = await resolveConfig({ root, renderer: false }, "production");

    await expect(build(config, { root, preset: "cloudflare-module" })).rejects.toThrow(
      /"cloudflare-module" preset cannot run server code that imports src\/wasm\/math\.wasm\..*@farm\.js\/wasm/,
    );
    await expect(fs.access(path.join(root, ".farm", ".output", "server"))).rejects.toThrow();
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
    // Server code still reads the public ones, so they also belong beside the server bundle.
    expect([...collectServerReadSSRAssets(bundle)].sort()).toEqual([
      "assets/linked-abc.wasm",
      "assets/styled-def.png",
    ]);
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
