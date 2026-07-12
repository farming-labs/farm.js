import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export async function createMiddlewareProductionFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-middleware-"));

  await fs.mkdir(path.join(root, "node_modules", "@farmjs"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farmjs", "core"), "dir");

  await fs.mkdir(path.join(root, "src", "app", "dashboard", "settings"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "users", "[id]", "settings"), {
    recursive: true,
  });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
export default {
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
  observability: {
    onEvent(event) {
      if (!event.type.startsWith("middleware.")) return;
      globalThis.__farmMiddlewareEvents ||= [];
      globalThis.__farmMiddlewareEvents.push({
        type: event.type,
        route: event.route,
        pathname: event.pathname,
        name: event.name,
        status: event.status,
        durationMs: event.durationMs,
      });
    },
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
    path.join(root, "src", "farm.routes.tsx"),
    `
import { createRoute, defineRoutes } from "@farmjs/core/routes";

export const ProgrammaticRoute = createRoute("/programmatic/[id]", {
  component({ params }: { params: { id: string } }) {
    return <main>{\`production programmatic route: \${params.id}\`}</main>;
  },
});

export default defineRoutes(({ api }) => [
  ProgrammaticRoute,
  api("/api/programmatic/[id]", {
    async GET(_request: Request, context: { params: Promise<{ id: string }> }) {
      const params = await context.params;
      return Response.json({ id: params.id });
    },
  }),
]);
`.trim(),
  );
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
  await fs.writeFile(
    path.join(root, "src", "app", "users", "[id]", "middleware.ts"),
    `
export default async function userMiddleware(ctx: any, next: () => Promise<void>) {
  ctx.data.set("file.userId", ctx.params.id || "missing-id");
  await next();
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "users", "[id]", "settings", "page.tsx"),
    `
import React from "react";

export default function UserSettingsPage(props: any) {
  return React.createElement(
    "main",
    null,
    \`user settings: \${props.middleware?.data.get("file.userId") || "missing"} / \${props.params.id}\`
  );
}
`.trim(),
  );

  return root;
}

export async function cleanupMiddlewareProductionFixture(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}
