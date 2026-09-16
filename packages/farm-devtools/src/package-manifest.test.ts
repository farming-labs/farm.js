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
    expect(manifest.peerDependencies?.["@farm.js/core"]).toBe(">=0.1.0-beta.96 <0.2.0");
    expect(manifest.devDependencies?.["@farm.js/core"]).toBe("workspace:*");
  });
});
