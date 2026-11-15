import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import farmRsc from "../index.js";
import { linkRscFixtureDependencies } from "../test-fixture-dependencies.js";
import type { EntryContext } from "../types.js";
import { generateClientEntry } from "./client.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    if (existsSync(fixture)) rmSync(fixture, { recursive: true, force: true });
  }
});

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: undefined,
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "optimize-deps-test",
  debug: false,
  mobileClient: "inline",
};

async function resolveClientOptimizeInclude(): Promise<string[]> {
  const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-client-optimize-deps-"));
  fixtures.push(root);
  linkRscFixtureDependencies(root);
  const configPlugin = farmRsc().find((plugin) => plugin.name === "@farm.js/plugin/rsc:config");
  const configHook = configPlugin?.config as (
    config: Record<string, unknown>,
    env: { command: "serve"; mode: string },
  ) => Promise<{ environments: { client: { optimizeDeps: { include: string[] } } } }>;
  const resolved = await configHook(
    { root, srcDir: "src", experimental: { serverComponents: true } },
    { command: "serve", mode: "development" },
  );
  return resolved.environments.client.optimizeDeps.include;
}

describe("client entry dependency optimization", () => {
  // Vite re-optimizes when the first page finds a new dependency, and until the reload client
  // components can see two copies of React ("Invalid hook call").
  it("optimizes every Farm module the browser entry imports before the first page", async () => {
    const imported = new Set(
      [...generateClientEntry(context).matchAll(/from '(@farm\.js\/core[^']*)'/g)].map(
        (match) => match[1],
      ),
    );
    expect(imported.size).toBeGreaterThan(0);

    expect(await resolveClientOptimizeInclude()).toEqual(expect.arrayContaining([...imported]));
  });
});
