import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { generateRscEntry } from "./entries/rsc.js";
import {
  FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER,
  FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER,
  createFarmRscMobileClientManifestPlugin,
  farmRscMobileClientManifestPath,
  finalizeFarmRscMobileClient,
  generateMobileClientEntry,
  generateMobileShellNavigation,
  patchFarmRscMobileShellClient,
  patchFarmRscNativeStylesheets,
} from "./mobile-client.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "farm-rsc-mobile-"));
  roots.push(root);
  return root;
}

const entryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "test",
  debug: false,
};

describe("the RSC mobile client", () => {
  it("is an entry that installs the shell's delegate and runs the browser entry", () => {
    const source = generateMobileClientEntry("./.farm/rsc-entries/entry.browser.tsx");
    expect(source).toContain('import "./.farm/rsc-entries/entry.browser.tsx";');
    // The delegate is in the entry module itself, not in a core module the browser entry also
    // imports, which the bundler would place in the web client's chunks.
    expect(source).toContain(generateMobileShellNavigation());
    expect(source).not.toContain("@farm.js/core/internal/client-runtime");
  });

  it("tells the shell a page is ready once it has loaded, since RSC installs no SPA router", async () => {
    const [, ...body] = generateMobileShellNavigation().split("\n");
    const run = (readyState: string) => {
      const calls: unknown[] = [];
      const listeners: Record<string, () => void> = {};
      const bridge = {
        ready(this: unknown) {
          calls.push(this);
        },
      };
      new Function(
        "globalThis",
        "farmDelegateNavigation",
        "document",
        "addEventListener",
        body.join("\n"),
      )(
        { __farmBridge: bridge },
        () => {},
        { readyState },
        (type: string, listener: () => void) => (listeners[type] = listener),
      );
      return { bridge, calls, listeners };
    };
    const loaded = run("complete");
    await Promise.resolve();
    expect(loaded.calls).toEqual([loaded.bridge]);
    const loading = run("loading");
    await Promise.resolve();
    expect(loading.calls).toEqual([]);
    loading.listeners.load!();
    expect(loading.calls).toEqual([loading.bridge]);
  });

  it("hands navigations to the shell's bridge, and does nothing in a browser", () => {
    const [imports, ...body] = generateMobileShellNavigation().split("\n");
    expect(imports).toBe(
      "import { delegateNavigation as farmDelegateNavigation } from '@farm.js/core/client';",
    );
    const run = (globalThisValue: object) => {
      const delegates: ((context: unknown) => unknown)[] = [];
      new Function("globalThis", "farmDelegateNavigation", body.join("\n"))(
        globalThisValue,
        (delegate: (context: unknown) => unknown) => delegates.push(delegate),
      );
      return delegates;
    };
    expect(run({})).toEqual([]);
    expect(run({ __farmBridge: {} })).toEqual([]);

    const offered: unknown[] = [];
    const bridge = {
      takes: true,
      offerNavigation(this: { takes: unknown }, context: unknown) {
        offered.push(context);
        return this.takes;
      },
    };
    const [delegate] = run({ __farmBridge: bridge });
    const context = { url: "https://app.test/notes", from: "/", to: "/notes", action: "push" };
    expect(delegate!(context)).toBe(true);
    expect(offered).toEqual([context]);
    // Only a literal true takes the navigation.
    bridge.takes = "yes";
    expect(delegate!(context)).toBe(false);
  });

  it("adds shell handling to the server entry only for a build with the mobile entry", () => {
    for (const mobileClient of [undefined, "inline" as const]) {
      const entry = generateRscEntry({ ...entryContext, mobileClient });
      expect(entry).not.toContain("_applyFarmMobileShellClient");
      expect(entry).not.toContain(FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER);
      expect(entry).not.toContain(FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER);
    }
    // A web-only app has no native-tier screens; `farm dev --mobile` reads CSS from Vite.
    expect(generateRscEntry({ ...entryContext })).not.toContain("createFarmNativeTreeResponse");
    const dev = generateRscEntry({ ...entryContext, mobileClient: "inline" });
    expect(dev).toContain("createFarmNativeTreeResponse");
    expect(dev).toContain("url.hostname = '127.0.0.1'");
    const entry = generateRscEntry({ ...entryContext, mobileClient: "entry" });
    expect(entry).toContain(
      "import { _applyFarmMobileShellClient, createFarmNativeTreeResponse, resolveFarmWebRequestOrigin } from '@farm.js/core/internal/production-runtime';",
    );
    // Links and server-action forms use the public origin only under server.trustProxy.
    expect(entry).toContain(
      "origin: resolveFarmWebRequestOrigin(request, {\n        trustProxy: false,",
    );
    expect(dev).toContain(
      "origin: resolveFarmWebRequestOrigin(request, {\n        trustProxy: false,",
    );
    for (const mobileClient of ["entry", "inline"] as const) {
      expect(
        generateRscEntry({ ...entryContext, mobileClient, server: { trustProxy: true } }),
      ).toContain("origin: resolveFarmWebRequestOrigin(request, {\n        trustProxy: true,");
    }
    // Native-tier screens: the tree, with the embedded CSS and the page marked for its render only.
    expect(entry).toContain("application/vnd.farm.native+json");
    expect(entry).toContain("farmNativeTreeRenders.add(target)");
    expect(entry).toContain(`JSON.parse("${FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER}")`);
    expect(entry).toContain("headers.delete('x-farm-native-tree')");
    expect(entry).toContain(
      "return _applyFarmMobileShellClient(request, response, farmMobileShellClient);",
    );
    expect(entry).toContain(`JSON.parse("${FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER}")`);
  });

  it("embeds the client CSS for native-tier screens only where the server bundle asks", () => {
    const root = tempRoot();
    const rscDir = path.join(root, "rsc");
    const publicDir = path.join(root, "public");
    mkdirSync(path.join(rscDir, "chunks"), { recursive: true });
    mkdirSync(path.join(publicDir, "assets", "nested"), { recursive: true });
    writeFileSync(path.join(publicDir, "assets", "index-A1.css"), ".card{padding:8px}\n");
    writeFileSync(
      path.join(publicDir, "assets", "nested", "route-B2.css"),
      'a::after{content:"$`\'"}',
    );
    writeFileSync(path.join(publicDir, "assets", "index-A1.js"), "console.log(1)");
    const entry = path.join(rscDir, "index.mjs");
    writeFileSync(
      entry,
      `const sheets = JSON.parse("${FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER}"); export { sheets };`,
    );
    const other = path.join(rscDir, "chunks", "other.mjs");
    writeFileSync(other, "export const unrelated = 1;");
    patchFarmRscNativeStylesheets(rscDir, publicDir);
    const code = readFileSync(entry, "utf8");
    expect(code).not.toContain(FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER);
    // The patched literal parses back to every stylesheet by href, quotes and $ included.
    const literal = /JSON\.parse\("(.*)"\)/.exec(code)![1]!;
    expect(JSON.parse(JSON.parse(`"${literal}"`))).toEqual({
      "/assets/index-A1.css": ".card{padding:8px}\n",
      "/assets/nested/route-B2.css": 'a::after{content:"$`\'"}',
    });
    expect(readFileSync(other, "utf8")).toBe("export const unrelated = 1;");
  });

  it("records the entry, finishes core's manifest, and fills in the server bundle once", () => {
    const root = tempRoot();
    const clientDir = path.join(root, ".nitro", "vite", "dist", "client");
    mkdirSync(path.join(clientDir, "assets"), { recursive: true });
    writeFileSync(
      path.join(clientDir, "assets", "farm-mobile-client-Bx9_k2Qa.js"),
      "import './index-C1d2E3f4.js';",
    );
    const plugin = createFarmRscMobileClientManifestPlugin(() => root);
    const bundle = {
      "assets/index-C1d2E3f4.js": { type: "chunk", name: "index", isEntry: true },
      "assets/farm-mobile-client-Bx9_k2Qa.js": {
        type: "chunk",
        name: "farm-mobile-client",
        isEntry: true,
      },
      "assets/counter-Dk3-a9Zq.js": { type: "chunk", name: "counter" },
      "assets/index-Q8w7e6R5.css": { type: "asset" },
      "assets/index-C1d2E3f4.js.map": { type: "asset" },
    };
    // Only the client environment records.
    plugin.generateBundle.call({ environment: { name: "ssr" } }, {}, bundle);
    expect(() => readFileSync(farmRscMobileClientManifestPath(root))).toThrow();
    plugin.generateBundle.call({ environment: { name: "client" } }, {}, bundle);

    const rscDir = path.join(root, "rsc");
    mkdirSync(path.join(rscDir, "assets"), { recursive: true });
    const source = `const c = JSON.parse("${FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER}");`;
    writeFileSync(path.join(rscDir, "assets", "server.js"), source);
    writeFileSync(path.join(rscDir, "index.js"), "export {};");
    let resolved = 0;
    const resolve = () => {
      resolved += 1;
      return finalizeFarmRscMobileClient({
        root,
        clientDir,
        webEntry: "/assets/index-C1d2E3f4.js",
        stylesheet: "/assets/index-Q8w7e6R5.css",
      });
    };
    patchFarmRscMobileShellClient(rscDir, resolve);
    patchFarmRscMobileShellClient(rscDir, resolve);
    expect(resolved).toBe(1);

    const patched = readFileSync(path.join(rscDir, "assets", "server.js"), "utf8");
    const client = new Function(`${patched}; return c;`)();
    expect(client).toEqual({
      webEntry: "/assets/index-C1d2E3f4.js",
      entry: "/assets/farm-mobile-client-Bx9_k2Qa.js",
      webOnly: [],
    });
    expect(readFileSync(path.join(rscDir, "index.js"), "utf8")).toBe("export {};");
    expect(JSON.parse(readFileSync(farmRscMobileClientManifestPath(root), "utf8"))).toEqual({
      version: 1,
      webEntry: "/assets/index-C1d2E3f4.js",
      entry: "/assets/farm-mobile-client-Bx9_k2Qa.js",
      stylesheet: "/assets/index-Q8w7e6R5.css",
      files: [
        "/assets/counter-Dk3-a9Zq.js",
        "/assets/farm-mobile-client-Bx9_k2Qa.js",
        "/assets/index-C1d2E3f4.js",
        "/assets/index-Q8w7e6R5.css",
      ],
      clientDir: ".nitro/vite/dist/client",
    });
  });

  it("leaves the server without a mobile client when the entry was not written", () => {
    const root = tempRoot();
    const plugin = createFarmRscMobileClientManifestPlugin(() => root);
    plugin.generateBundle.call(
      { environment: { name: "client" } },
      {},
      { "assets/index-C1d2E3f4.js": { type: "chunk", name: "index", isEntry: true } },
    );
    expect(
      finalizeFarmRscMobileClient({
        root,
        clientDir: path.join(root, "client"),
        webEntry: "/assets/index-C1d2E3f4.js",
        stylesheet: "",
      }),
    ).toBeNull();
    const rscDir = path.join(root, "rsc");
    mkdirSync(rscDir, { recursive: true });
    writeFileSync(
      path.join(rscDir, "index.js"),
      `function read() { try { return JSON.parse("${FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER}"); } catch { return null; } } const c = read();`,
    );
    patchFarmRscMobileShellClient(rscDir, () => null);
    expect(
      new Function(`${readFileSync(path.join(rscDir, "index.js"), "utf8")}; return c;`)(),
    ).toBeNull();
  });
});
