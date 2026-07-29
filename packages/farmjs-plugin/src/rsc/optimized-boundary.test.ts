import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import farmRsc from "./index.js";

const fixtures: string[] = [];

function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-optimized-boundary-"));
  fixtures.push(root);

  return root;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    if (existsSync(fixture)) rmSync(fixture, { recursive: true, force: true });
  }
});

describe("experimental optimized boundary", () => {
  it("requires the explicit experimental flag", () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:optimized-boundary",
    );
    const resolveId = plugin?.resolveId as (
      id: string,
      importer: string,
      options: { ssr?: boolean },
    ) => unknown;

    expect(() =>
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farm.js/plugin/rsc/optimized-boundary",
        "/app/src/page.tsx",
        { ssr: true },
      ),
    ).toThrow(/experimental\.optimizedBoundary is disabled/);
  });

  it("externalizes Strata on the server and rejects client imports", async () => {
    const root = createFixture();
    const plugins = farmRsc();
    const configPlugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
    );
    const configHook = configPlugin?.config as (
      config: Record<string, unknown>,
      env: { command: "build"; mode: string },
    ) => Promise<any>;

    const resolved = await configHook(
      {
        root,
        srcDir: "src",
        experimental: {
          serverComponents: true,
          optimizedBoundary: true,
        },
      },
      { command: "build", mode: "production" },
    );

    expect(resolved.ssr.external).toEqual(
      expect.arrayContaining(["@farming-labs/strata", "@farming-labs/strata/react-server"]),
    );
    expect(resolved.optimizeDeps.exclude).toEqual(
      expect.arrayContaining(["@farming-labs/strata", "@farming-labs/strata/react-server"]),
    );

    const staticPlugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:optimized-boundary",
    );
    const resolveId = staticPlugin?.resolveId as (
      id: string,
      importer: string,
      options: { ssr?: boolean },
    ) => unknown;

    expect(
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farm.js/plugin/rsc/optimized-boundary",
        "/app/src/page.tsx",
        { ssr: true },
      ),
    ).toBeNull();
    expect(
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farming-labs/strata",
        "@farm.js/plugin/rsc/optimized-boundary",
        { ssr: true },
      ),
    ).toEqual({
      id: "@farming-labs/strata",
      external: true,
    });
    expect(
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farming-labs/strata/react-server",
        "@farm.js/plugin/rsc/optimized-boundary",
        { ssr: true },
      ),
    ).toEqual({
      id: "@farming-labs/strata/react-server",
      external: true,
    });
    expect(() =>
      resolveId.call(
        { environment: { name: "client" } },
        "@farm.js/plugin/rsc/optimized-boundary",
        "/app/src/client.tsx",
        { ssr: false },
      ),
    ).toThrow(/server-only/);
  });

  it("rejects optimized boundaries when server components are disabled", async () => {
    const configPlugin = farmRsc().find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
    );
    const configHook = configPlugin?.config as (
      config: Record<string, unknown>,
      env: { command: "build"; mode: string },
    ) => Promise<unknown>;

    await expect(
      configHook(
        {
          root: createFixture(),
          experimental: {
            serverComponents: false,
            optimizedBoundary: true,
          },
        },
        { command: "build", mode: "production" },
      ),
    ).rejects.toThrow(/requires experimental\.serverComponents/);
  });
});
