// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  FARM_REACT_WEB_SERVER_ALIAS,
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
    const { find, replacement } = FARM_REACT_WEB_SERVER_ALIAS;
    expect(find.test("react-dom/server")).toBe(true);
    // ./server.browser exists in React 18 and 19; ./server.edge is 19 only.
    expect(replacement).toBe("react-dom/server.browser");
    // An app importing a specific build must keep the build it asked for.
    expect(find.test("react-dom/server.node")).toBe(false);
    expect(find.test("react-dom/server.browser")).toBe(false);
    expect(find.test("react-dom/server.edge")).toBe(false);
  });
});
