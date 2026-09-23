// @vitest-environment node

import { describe, expect, it } from "vitest";
import { loadOptions } from "nitro";
import path from "node:path";
import { resolveFarmNitroOutputConfig } from "../nitro/universal-build";

describe("Farm Nitro output layout", () => {
  it.each(["node-server", "vercel", "vercel-edge"])(
    "keeps Farm's server/public layout for %s",
    (preset) => {
      expect(resolveFarmNitroOutputConfig(preset, "/tmp/farm-output")).toEqual({
        dir: "/tmp/farm-output",
        serverDir: "/tmp/farm-output/server",
        publicDir: "/tmp/farm-output/public",
      });
    },
  );

  it.each(["cloudflare-pages", "cloudflare-module", "netlify", "netlify-edge"])(
    "leaves the %s preset's native directories untouched",
    (preset) => {
      expect(resolveFarmNitroOutputConfig(preset, "/tmp/farm-output")).toEqual({
        dir: "/tmp/farm-output",
      });
    },
  );

  it("lets Nitro resolve Cloudflare Pages' worker and public directories", async () => {
    const outputDir = "/tmp/farm-output";
    const options = await loadOptions({
      preset: "cloudflare-pages",
      rootDir: process.cwd(),
      srcDir: process.cwd(),
      output: resolveFarmNitroOutputConfig("cloudflare-pages", outputDir),
    });

    expect(options.output?.serverDir).not.toBe(path.join(outputDir, "server"));
    expect(options.output?.publicDir).not.toBe(path.join(outputDir, "public"));
    expect(options.output?.serverDir).toContain("_worker.js");
  });
});
