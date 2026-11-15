// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFarmRenderer, resolveFarmRendererAppSetup } from "../renderer";

const renderer = {
  name: "vue",
  vite: "@farm.js/vue/vite",
  server: "@farm.js/vue/server",
  client: "@farm.js/vue/client",
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("renderer appSetup", () => {
  it("keeps appSetup on the resolved renderer and rejects an empty path", () => {
    expect(resolveFarmRenderer({ ...renderer, appSetup: "./src/vue-app.ts" }).appSetup).toBe(
      "./src/vue-app.ts",
    );
    expect(() => resolveFarmRenderer({ ...renderer, appSetup: " " })).toThrow(
      "Farm renderer `appSetup` must be a non-empty module path.",
    );
  });

  it("resolves the module against the project root, or null without one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-renderer-app-setup-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "vue-app.ts"), "export default () => {};");

    expect(resolveFarmRendererAppSetup(root, { ...renderer, appSetup: "./src/vue-app.ts" })).toBe(
      path.join(root, "src", "vue-app.ts"),
    );
    expect(resolveFarmRendererAppSetup(root, renderer)).toBeNull();
  });

  it("names the missing module", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-renderer-app-setup-"));
    roots.push(root);

    expect(() =>
      resolveFarmRendererAppSetup(root, { ...renderer, appSetup: "./src/missing.ts" }),
    ).toThrow(
      `Renderer \`vue\` app setup module was not found: ${path.join(root, "src", "missing.ts")}`,
    );
  });
});
