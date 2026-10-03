// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFarmReactWebServerAlias,
  hasReactDomEdgeServerBuild,
  shouldAliasReactServerToWebBuild,
} from "../nitro/universal-build";
import { REACT_RENDERER } from "../renderer";

const svelte = { name: "svelte" } as const;

describe("React Web streaming on edge presets", () => {
  it("aliases React's server entry to the Web build for edge presets", () => {
    for (const preset of [
      "cloudflare",
      "cloudflare-pages",
      "cloudflare-module",
      "vercel-edge",
      "netlify-edge",
      "deno",
    ]) {
      expect(shouldAliasReactServerToWebBuild(REACT_RENDERER, preset)).toBe(true);
    }
  });

  it("leaves Node presets on React's Node server build", () => {
    // The Node build is the correct one there: it exports
    // renderToPipeableStream, which the production renderer prefers.
    for (const preset of ["node-server", "vercel", "netlify", "aws-lambda", "bun", "self-host"]) {
      expect(shouldAliasReactServerToWebBuild(REACT_RENDERER, preset)).toBe(false);
    }
  });

  it("does not touch resolution for non-React renderers", () => {
    // Other renderers externalize react-dom entirely, so aliasing it would be
    // both pointless and a way to pull React into a build that has none.
    expect(shouldAliasReactServerToWebBuild(svelte, "cloudflare")).toBe(false);
    expect(shouldAliasReactServerToWebBuild(svelte, "vercel-edge")).toBe(false);
  });

  it("treats an unresolved renderer as React, matching isReactRenderer", () => {
    expect(shouldAliasReactServerToWebBuild(undefined, "cloudflare")).toBe(true);
  });

  it("targets only the bare server entry, not the explicit subpaths", () => {
    const { find } = createFarmReactWebServerAlias(true);
    expect(find.test("react-dom/server")).toBe(true);
    // An app importing a specific build must keep the build it asked for.
    expect(find.test("react-dom/server.node")).toBe(false);
    expect(find.test("react-dom/server.browser")).toBe(false);
    expect(find.test("react-dom/server.edge")).toBe(false);
  });

  it("prefers React's edge build and falls back to the browser build", () => {
    // React 19's browser server build needs a global MessageChannel, which a
    // Cloudflare Worker lacks on older compatibility dates. React 18 has no
    // edge build, and its browser build does not need MessageChannel.
    expect(createFarmReactWebServerAlias(true).replacement).toBe("react-dom/server.edge");
    expect(createFarmReactWebServerAlias(false).replacement).toBe("react-dom/server.browser");
  });

  it("detects the edge build from the app's installed React DOM", async () => {
    expect(hasReactDomEdgeServerBuild(process.cwd())).toBe(true);

    // React 18's export map has ./server.browser and ./server.node only.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-react18-dom-"));
    try {
      const reactDom = path.join(root, "node_modules", "react-dom");
      await fs.mkdir(reactDom, { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), "{}");
      await fs.writeFile(
        path.join(reactDom, "package.json"),
        JSON.stringify({
          name: "react-dom",
          version: "18.3.1",
          exports: {
            "./server.browser": "./server.browser.js",
            "./server.node": "./server.node.js",
          },
        }),
      );
      await fs.writeFile(path.join(reactDom, "server.browser.js"), "");
      expect(hasReactDomEdgeServerBuild(root)).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
