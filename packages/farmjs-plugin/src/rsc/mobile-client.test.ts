import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { generateRscEntry } from "./entries/rsc.js";
import {
  FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER,
  createFarmRscMobileClientManifestPlugin,
  farmRscMobileClientManifestPath,
  finalizeFarmRscMobileClient,
  generateMobileClientEntry,
  patchFarmRscMobileShellClient,
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
    expect(source).toContain(
      "import { installFarmMobileShellNavigation } from '@farm.js/core/internal/client-runtime';",
    );
    expect(source).toContain('import "./.farm/rsc-entries/entry.browser.tsx";');
    expect(source.trim().endsWith("installFarmMobileShellNavigation();")).toBe(true);
  });

  it("adds shell handling to the server entry only for a build with the mobile entry", () => {
    for (const mobileClient of [undefined, "inline" as const]) {
      const entry = generateRscEntry({ ...entryContext, mobileClient });
      expect(entry).not.toContain("_applyFarmMobileShellClient");
      expect(entry).not.toContain(FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER);
    }
    const entry = generateRscEntry({ ...entryContext, mobileClient: "entry" });
    expect(entry).toContain(
      "import { _applyFarmMobileShellClient } from '@farm.js/core/internal/production-runtime';",
    );
    expect(entry).toContain(
      "return _applyFarmMobileShellClient(request, response, farmMobileShellClient);",
    );
    expect(entry).toContain(`JSON.parse("${FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER}")`);
  });

  it("records the entry, finishes core's manifest, and fills in the server bundle once", () => {
    const root = tempRoot();
    const clientDir = path.join(root, ".nitro", "vite", "dist", "client");
    mkdirSync(path.join(clientDir, "assets"), { recursive: true });
    writeFileSync(path.join(clientDir, "assets", "farm-mobile-client-Bx9_k2Qa.js"), "import './index-C1d2E3f4.js';");
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
    expect(new Function(`${readFileSync(path.join(rscDir, "index.js"), "utf8")}; return c;`)()).toBeNull();
  });
});
