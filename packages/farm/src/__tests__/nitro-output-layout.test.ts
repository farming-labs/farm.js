// @vitest-environment node

import { describe, expect, it } from "vitest";
import { loadOptions } from "nitro/builder";
import path from "node:path";
import {
  resolveCloudflareProcessEnvFlags,
  resolveFarmNitroOutputConfig,
} from "../nitro/universal-build";

describe("Farm Nitro output layout", () => {
  it("keeps Farm's server/public layout for node-server", () => {
    expect(resolveFarmNitroOutputConfig("node-server", "/tmp/farm-output")).toEqual({
      dir: "/tmp/farm-output",
      serverDir: path.join("/tmp/farm-output", "server"),
      publicDir: path.join("/tmp/farm-output", "public"),
    });
  });

  it("uses Vercel's native Build Output layout for vercel", () => {
    expect(resolveFarmNitroOutputConfig("vercel", "/tmp/farm-output")).toEqual({
      dir: "/tmp/farm-output",
      serverDir: path.join("/tmp/farm-output", "functions", "__nitro.func"),
      publicDir: path.join("/tmp/farm-output", "static"),
    });
  });

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
      serverDir: process.cwd(),
      output: resolveFarmNitroOutputConfig("cloudflare-pages", outputDir),
    });

    expect(options.output?.serverDir).not.toBe(path.join(outputDir, "server"));
    expect(options.output?.publicDir).not.toBe(path.join(outputDir, "public"));
    expect(options.output?.serverDir).toContain("_worker.js");
  });

  it("matches Nitro's own Netlify layout with Farm's default Netlify output", async () => {
    const rootDir = process.cwd();
    const native = await loadOptions({ preset: "netlify", rootDir, serverDir: rootDir });
    const farm = await loadOptions({
      preset: "netlify",
      rootDir,
      serverDir: rootDir,
      output: resolveFarmNitroOutputConfig(
        "netlify",
        path.join(rootDir, ".netlify", "functions-internal"),
      ),
    });

    expect(farm.output?.serverDir).toBe(native.output?.serverDir);
    expect(farm.output?.publicDir).toBe(native.output?.publicDir);
    expect(path.resolve(farm.output?.serverDir ?? "")).toBe(
      path.join(rootDir, ".netlify", "functions-internal", "server"),
    );
  });
});

describe("Cloudflare process.env flag", () => {
  it("populates process.env for a compatibility date before it became the default", () => {
    expect(
      resolveCloudflareProcessEnvFlags({
        compatibility_date: "2024-12-01",
        compatibility_flags: ["nodejs_compat"],
      }),
    ).toEqual(["nodejs_compat", "nodejs_compat_populate_process_env"]);
  });

  it.each([
    ["a date that already populates it", "2025-04-01", ["nodejs_compat"]],
    ["the flag already set", "2024-12-01", ["nodejs_compat", "nodejs_compat_populate_process_env"]],
    [
      "an explicit opt-out",
      "2024-12-01",
      ["nodejs_compat", "nodejs_compat_do_not_populate_process_env"],
    ],
    ["no Node.js compatibility", "2024-12-01", []],
  ])("leaves a config with %s unchanged", (_label, date, flags) => {
    expect(
      resolveCloudflareProcessEnvFlags({ compatibility_date: date, compatibility_flags: flags }),
    ).toBeUndefined();
  });
});
