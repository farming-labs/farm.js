// @vitest-environment node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import {
  cleanupMiddlewareProductionFixture,
  createMiddlewareProductionFixture,
} from "./fixtures/middleware-production-fixture";

describe("production middleware runtime", () => {
  it(
    "runs farm.config middleware and app middleware in a production build",
    async () => {
      const root = await createMiddlewareProductionFixture();

      try {
        const userConfig = await loadConfig(root, undefined, "production");
        const config = await resolveConfig({ ...(userConfig || {}), root }, "production");
        await build(config, { root, preset: "vercel" });

        const entryPath = path.join(
          root,
          ".vercel",
          "output",
          "functions",
          "__nitro.func",
          "index.mjs",
        );
        const serverModule = await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`);
        (globalThis as any).__farmMiddlewareEvents = [];
        const response = await serverModule.default.fetch(
          new Request("https://example.test/dashboard/settings"),
        );
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get("x-farm-middleware")).toBe("yes");
        expect(html).toContain(
          "production middleware: dashboard / settings / dashboard-file / /dashboard/settings",
        );
        expect(
          (globalThis as any).__farmMiddlewareEvents.map((event: any) => event.type),
        ).toEqual([
          "middleware.start",
          "middleware.complete",
          "middleware.start",
          "middleware.complete",
        ]);

        (globalThis as any).__farmMiddlewareEvents = [];
        const configResponse = await serverModule.default.fetch(
          new Request("https://example.test/dashboard/config-response"),
        );
        expect(configResponse.status).toBe(302);
        expect(configResponse.headers.get("location")).toBe("https://example.test/sign-in");
        expect(
          (globalThis as any).__farmMiddlewareEvents.map((event: any) => event.type),
        ).toEqual(["middleware.start", "middleware.shortCircuit"]);
        expect((globalThis as any).__farmMiddlewareEvents[1]).toMatchObject({
          route: "/",
          status: 302,
        });

        (globalThis as any).__farmMiddlewareEvents = [];
        const fileResponse = await serverModule.default.fetch(
          new Request("https://example.test/dashboard/file-response"),
        );
        expect(fileResponse.status).toBe(418);
        expect(fileResponse.headers.get("x-file-response")).toBe("yes");
        expect(fileResponse.headers.get("x-farm-middleware")).toBe("yes");
        await expect(fileResponse.text()).resolves.toBe("blocked by file middleware");
        expect(
          (globalThis as any).__farmMiddlewareEvents.map((event: any) => event.type),
        ).toEqual([
          "middleware.start",
          "middleware.complete",
          "middleware.start",
          "middleware.shortCircuit",
        ]);
        expect((globalThis as any).__farmMiddlewareEvents[3]).toMatchObject({
          route: "/dashboard",
          status: 418,
        });

        (globalThis as any).__farmMiddlewareEvents = [];
        const userResponse = await serverModule.default.fetch(
          new Request("https://example.test/users/42/settings"),
        );
        const userHtml = await userResponse.text();
        expect(userResponse.status).toBe(200);
        expect(userHtml).toContain("user settings: 42 / 42");
        expect((globalThis as any).__farmMiddlewareEvents[0]).toMatchObject({
          route: "/users/[id]",
          pathname: "/users/42/settings",
        });
      } finally {
        delete (globalThis as any).__farmMiddlewareEvents;
        await cleanupMiddlewareProductionFixture(root);
      }
    },
    120_000,
  );
});
