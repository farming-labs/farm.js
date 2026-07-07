// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createProductionMiddlewareFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-middleware-"));

  await fs.mkdir(path.join(root, "node_modules", "@farmjs"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farmjs", "core"), "dir");

  await fs.mkdir(path.join(root, "src", "app", "dashboard", "settings"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
export default {
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
  middleware: [
    {
      matcher: "/dashboard/config-response",
      handler(ctx) {
        return Response.redirect(new URL("/sign-in", ctx.url));
      },
    },
    {
      matcher: "/dashboard/:path*",
      async handler(ctx, next) {
        ctx.data.set("config.area", "dashboard");
        ctx.data.set("config.path", ctx.params.path || "");
        await next();
      },
    },
  ],
};
`.trim(),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "settings", "page.tsx"),
    `
import React from "react";

export default function DashboardPage(props: any) {
  const middlewareData = props.middleware?.data;
  const configArea = middlewareData?.get("config.area") || "missing-config";
  const configPath = middlewareData?.get("config.path") || "missing-path";
  const fileArea = middlewareData?.get("file.area") || "missing-file";

  return React.createElement(
    "main",
    null,
    \`production middleware: \${configArea} / \${configPath} / \${fileArea} / \${props.path}\`
  );
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "middleware.ts"),
    `
export default async function dashboardMiddleware(ctx: any, next: () => Promise<void>) {
  ctx.data.set("file.area", "dashboard-file");
  ctx.headers.set("x-farm-middleware", "yes");
  if (ctx.pathname === "/dashboard/file-response") {
    return new Response("blocked by file middleware", {
      status: 418,
      headers: {
        "x-file-response": "yes",
      },
    });
  }
  await next();
}
`.trim(),
  );

  return root;
}

describe("production middleware runtime", () => {
  it(
    "runs farm.config middleware and app middleware in a production build",
    async () => {
      const root = await createProductionMiddlewareFixture();

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
        const response = await serverModule.default.fetch(
          new Request("https://example.test/dashboard/settings"),
        );
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get("x-farm-middleware")).toBe("yes");
        expect(html).toContain(
          "production middleware: dashboard / settings / dashboard-file / /dashboard/settings",
        );

        const configResponse = await serverModule.default.fetch(
          new Request("https://example.test/dashboard/config-response"),
        );
        expect(configResponse.status).toBe(302);
        expect(configResponse.headers.get("location")).toBe("https://example.test/sign-in");

        const fileResponse = await serverModule.default.fetch(
          new Request("https://example.test/dashboard/file-response"),
        );
        expect(fileResponse.status).toBe(418);
        expect(fileResponse.headers.get("x-file-response")).toBe("yes");
        expect(fileResponse.headers.get("x-farm-middleware")).toBe("yes");
        await expect(fileResponse.text()).resolves.toBe("blocked by file middleware");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
