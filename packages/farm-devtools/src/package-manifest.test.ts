import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("uses the application core package as a peer", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.["@farm.js/core"]).toBeUndefined();
    // 0.1.28 is the first core whose plugin entry exports resolveFarmDevtoolsConfig.
    expect(manifest.peerDependencies?.["@farm.js/core"]).toBe(">=0.1.28 <0.2.0");
    expect(manifest.devDependencies?.["@farm.js/core"]).toBe("workspace:*");
  });

  it("never imports core's main entry, which loads React", async () => {
    // A Preact, Solid, Vue, or Svelte app has no React installed, and every starter's config
    // loads this plugin; importing "@farm.js/core" from here failed their config load.
    for (const file of ["index.ts", "server.ts", "modules.ts", "panel.ts", "client.ts", "ui.ts"]) {
      const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
      // Type-only imports are erased, so they are fine.
      expect(source, file).not.toMatch(/^import (?!type\b)[^;]*from ["']@farm\.js\/core["']/m);
    }
  });
});
