import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export async function createMiddlewareProductionFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-middleware-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), {
    recursive: true,
  });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "dir");

  await fs.mkdir(path.join(root, "src", "app", "dashboard", "settings"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "src", "app", "dashboard", "explicit"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "src", "app", "users", "[id]", "settings"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "src", "app", "context-ppr"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "src", "app", "rewrite-target"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "src", "app", "metadata", "[id]"), {
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
  images: {
    path: "/media/image",
    qualities: [60],
  },
  context({ request, path }) {
    return {
      tenant: request.headers.get("x-farm-tenant") || "public",
      requestId: request.headers.get("x-request-id") || "request:" + path,
    };
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
      matcher: "/rewrite-alias",
      async handler(ctx, next) {
        ctx.rewrite("/rewrite-target");
        await next();
      },
    },
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
    path.join(root, "src", "app", "rewrite-target", "page.tsx"),
    `
import React from "react";
import { getCurrentRequest } from "@farm.js/core/request";

export default function RewriteTargetPage() {
  return React.createElement("main", null, "current request: " + new URL(getCurrentRequest().url).pathname);
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "context-ppr", "page.tsx"),
    `
export const ppr = true;

export default function ContextPPRPage() {
  return <main>configured context PPR route</main>;
}
`.trim(),
  );
  const productImage = await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 4,
      background: { r: 49, g: 130, b: 83, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "settings", "product.png"),
    productImage,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "opengraph-image.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "opengraph-image.alt.txt"),
    "Application preview",
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "opengraph-image.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mNk+M/wHwAF/gL+X5WvWQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "opengraph-image.alt.txt"),
    "Dashboard preview",
  );
  await fs.writeFile(
    path.join(root, "src", "farm.routes.tsx"),
    `
import { createRoute, defineRoutes } from "@farm.js/core/routes";

export const ProgrammaticRoute = createRoute("/programmatic/[id]", {
  component({ params }: { params: { id: string } }) {
    return <main>{\`production programmatic route: \${params.id}\`}</main>;
  },
});

export const ContextRoute = createRoute("/context/[id]", {
  data: {
    main({ context, params }: any) {
      return {
        id: params.id,
        tenant: context.tenant,
        requestId: context.requestId,
      };
    },
  },
  component({ data, context }: any) {
    return <main>{\`production route context: \${data.tenant} / \${data.id} / \${data.requestId} / \${context ? "leaked" : "private"}\`}</main>;
  },
});

export default defineRoutes(({ api }) => [
  ProgrammaticRoute,
  ContextRoute,
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
    path.join(root, "src", "app", "metadata", "layout.tsx"),
    `
import React from "react";

export const metadata = {
  openGraph: {
    siteName: "Farm catalog",
  },
};

export function generateMetadata({ params }: any) {
  return {
    description: \`Layout metadata for \${params.id}\`,
    openGraph: {
      description: \`Layout Open Graph metadata for \${params.id}\`,
    },
  };
}

export default function MetadataLayout({ children }: any) {
  return React.createElement("section", null, children);
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "metadata", "[id]", "page.tsx"),
    `
import React from "react";

export const metadata = {
  openGraph: {
    type: "article",
  },
};

export async function generateMetadata({ params, searchParams }: any) {
  const search = await searchParams;
  return {
    title: \`Product \${params.id} \${search.variant}\`,
    openGraph: {
      title: \`Product \${params.id}\`,
    },
  };
}

export default function MetadataPage({ params }: any) {
  return React.createElement("main", null, \`metadata page: \${params.id}\`);
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "settings", "page.tsx"),
    `
import React from "react";
import Image from "@farm.js/core/image";
import { DashboardIdentity } from "../dashboard-identity";
import productImage from "./product.png";

export const hydrate = true;

export default function DashboardPage(props: any) {
  const middlewareData = props.middleware?.data;
  const configArea = middlewareData?.get("config.area") || "missing-config";
  const configPath = middlewareData?.get("config.path") || "missing-path";
  const fileArea = middlewareData?.get("file.area") || "missing-file";

  return React.createElement(
    "main",
    null,
    \`production middleware: \${configArea} / \${configPath} / \${fileArea} / \${props.path}\`,
    React.createElement(DashboardIdentity),
    React.createElement(Image, {
      src: productImage,
      alt: "Optimized product",
      placeholder: "blur",
      "data-product-image": "",
    })
  );
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "explicit", "page.tsx"),
    `
import React from "react";

export const metadata = {
  title: "Explicit image",
  openGraph: {
    images: ["https://cdn.example.test/explicit.png"],
  },
};

export default function ExplicitImagePage() {
  return React.createElement("main", null, "explicit image page");
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "dashboard-identity.tsx"),
    `
import React from "react";
import { getMiddlewareContext } from "@farm.js/core/middleware";
import type { DashboardContext } from "./middleware";

export function DashboardIdentity() {
  const context = getMiddlewareContext<DashboardContext>();
  const session = context.get("session");
  const requestPath = context.get("requestPath");

  return React.createElement(
    "span",
    null,
    \` / server context: \${session?.userId || "missing"} / \${requestPath || "missing"}\`
  );
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "middleware.ts"),
    `
import type { RequestMiddlewareContext } from "@farm.js/core/middleware";

export interface DashboardContext {
  session: { userId: string; secret: string };
  requestPath: string;
}

export const config = {
  matcher: "/dashboard/:path*",
};

export async function middleware(
  request: Request,
  context: RequestMiddlewareContext<DashboardContext>,
) {
  const pathname = new URL(request.url).pathname;
  context.set("session", {
    userId: "dashboard-user",
    secret: "never-serialize-this-session-secret",
  });
  context.set("requestPath", pathname);
  context.data.set("file.area", "dashboard-file");
  context.headers.set("x-farm-middleware", "yes");
  if (pathname === "/dashboard/file-response") {
    return new Response("blocked by file middleware", {
      status: 418,
      headers: {
        "x-file-response": "yes",
      },
    });
  }
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "users", "[id]", "middleware.ts"),
    `
export default async function userMiddleware(ctx: any, next: () => Promise<void>) {
  ctx.data.set("file.userId", ctx.params.id || "missing-id");
  ctx.locals.set("file.userId", ctx.params.id || "missing-id");
  await next();
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "users", "[id]", "settings", "page.tsx"),
    `
import React from "react";
import { getMiddlewareContext } from "@farm.js/core/middleware";

export default function UserSettingsPage(props: any) {
  const context = getMiddlewareContext<{ "file.userId": string }>();
  return React.createElement(
    "main",
    null,
    \`user settings: \${props.middleware?.data.get("file.userId") || "missing"} / \${context.get("file.userId") || "missing-context"} / \${props.params.id}\`
  );
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "users", "[id]", "opengraph-image.tsx"),
    `
import React from "react";

export const size = { width: 1200, height: 630 };
export const alt = "User preview";
export const contentType = "image/svg+xml";

export default function UserImage({ params }: { params: { id: string } }) {
  return React.createElement(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 1200 630" },
    React.createElement("text", null, \`User \${params.id}\`),
  );
}
`.trim(),
  );

  return root;
}

export async function cleanupMiddlewareProductionFixture(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}
