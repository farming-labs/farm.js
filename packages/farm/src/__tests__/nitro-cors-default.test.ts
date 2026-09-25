// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { createNitroConfig } from "../nitro";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps production API routes same-origin unless CORS is configured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-nitro-cors-"));
  roots.push(root);
  const config = await resolveConfig(
    {
      root,
      api: { basePath: "/internal-api" },
      images: { provider: "none" },
      telemetry: false,
    },
    "production",
  );
  const routes = { getRoutes: () => new Map() };
  const nitro = await createNitroConfig(config, routes as any, {} as any, {} as any);

  expect(nitro.routeRules?.["/internal-api/**"]).toBeUndefined();
  expect(nitro.routeRules?.["/**"]).toEqual({ prerender: false });
});
