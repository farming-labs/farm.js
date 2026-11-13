import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSsrEntry } from "./entries/ssr.js";
import farmRsc from "./index.js";
import { linkRscFixtureDependencies } from "./test-fixture-dependencies.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    if (existsSync(fixture)) rmSync(fixture, { recursive: true, force: true });
  }
});

async function resolveConfig(
  preset: string,
  command: "build" | "serve",
  experimental: Record<string, unknown> = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-workers-"));
  fixtures.push(root);
  linkRscFixtureDependencies(root);
  const configPlugin = farmRsc({ preset }).find(
    (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
  );
  const configHook = configPlugin?.config as (
    config: Record<string, unknown>,
    env: { command: "build" | "serve"; mode: string },
  ) => Promise<any>;
  return configHook(
    { root, srcDir: "src", experimental: { serverComponents: true, ...experimental } },
    { command, mode: command === "build" ? "production" : "development" },
  );
}

describe("RSC builds for Cloudflare Workers", () => {
  it("bundle the server's packages, built for workerd", async () => {
    const resolved = await resolveConfig("cloudflare-pages", "build");

    expect(resolved.environments.rsc.resolve).toMatchObject({
      conditions: ["react-server", "workerd", "worker", "import", "module"],
      noExternal: true,
    });
    expect(resolved.environments.ssr.resolve).toEqual({
      conditions: ["workerd", "worker", "import", "module"],
      noExternal: true,
    });
    // Nothing is left for a node_modules the worker doesn't have.
    expect(resolved.ssr).toBeUndefined();
  });

  it("refuse the optimized boundary, whose Strata loader needs Node", async () => {
    await expect(
      resolveConfig("cloudflare-pages", "build", { optimizedBoundary: true }),
    ).rejects.toThrow(
      /`experimental.optimizedBoundary` loads Strata.*Cloudflare Workers can't run/,
    );
  });

  it("leave Node builds and dev on Node's builds and node_modules", async () => {
    for (const resolved of [
      await resolveConfig("node-server", "build"),
      await resolveConfig("cloudflare-pages", "serve"),
    ]) {
      expect(resolved.environments.rsc.resolve.conditions).toEqual([
        "react-server",
        "node",
        "import",
      ]);
      expect(resolved.environments.rsc.resolve.noExternal).toBeUndefined();
      expect(resolved.environments.ssr.resolve).toEqual({ conditions: ["node", "import"] });
      expect(resolved.ssr.external).toEqual(expect.arrayContaining(["react", "react-dom/server"]));
    }
  });

  it("server-render to web streams, which workerd has, instead of Node streams", () => {
    const context = {
      srcDir: "src",
      outDir: "dist",
      basePath: "/",
      actionsEnabled: false,
      serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
      deploymentId: "test",
      debug: false,
    } as Parameters<typeof generateSsrEntry>[0];

    const workers = generateSsrEntry({ ...context, workers: true });
    expect(workers).toContain("import { renderToReadableStream } from 'react-dom/server';");
    expect(workers).not.toContain("renderToPipeableStream(");
    expect(workers).not.toContain("import('stream')");

    const node = generateSsrEntry(context);
    expect(node).toContain("import { renderToPipeableStream } from 'react-dom/server';");
    expect(node).not.toContain("renderToReadableStream");
  });
});
