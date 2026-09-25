// @vitest-environment node

import fs from "node:fs/promises";
import { createServer as createNodeServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { generateRuntimePathMatcherSource } from "../nitro/universal-build";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The production entry routes whatever `runtime.before` yields, so the dev page
// path has to resolve its route from the same request. This is the generated
// production matcher, used here to pin the pattern and params dev reports for a
// rewritten pathname to what a built app resolves for the same path.
const prodMatch = new Function(
  `${generateRuntimePathMatcherSource()}\nreturn matchRuntimePathPattern;`,
)() as (pattern: string, pathname: string) => Record<string, string> | null;

let root: string;
let server: ViteDevServer;
let origin: string;

async function writeModule(relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function getAvailablePort(): Promise<number> {
  const probe = createNodeServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

/** A route payload the dev path reported to a plugin, read back out of the HTML. */
function readReportedMeta(html: string, name: string): Record<string, unknown> | null {
  const match = new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html);
  if (!match) return null;
  return JSON.parse(match[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

const readReportedRoute = (html: string) => readReportedMeta(html, "farm-reported-route");
const readRouteMatch = (html: string) => readReportedMeta(html, "farm-route-match");

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-runtime-rewrite-"));

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  await fs.symlink(
    await fs.realpath(path.join(packageRoot, "node_modules", "react")),
    path.join(root, "node_modules", "react"),
    "junction",
  );
  await fs.symlink(
    await fs.realpath(path.join(packageRoot, "node_modules", "react-dom")),
    path.join(root, "node_modules", "react-dom"),
    "junction",
  );
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default {
  plugins: [{
    name: "rewrite-runtime-before",
    runtime: {
      before({ request }) {
        const url = new URL(request.url);
        if (url.pathname === "/from") {
          url.pathname = "/items/42";
          return new Request(url, request);
        }
        if (url.pathname === "/gone") {
          url.pathname = "/no-such-route";
          return new Request(url, request);
        }
        if (url.pathname === "/short") {
          return new Response("short-circuited", {
            status: 418,
            headers: { "content-type": "text/plain; charset=utf-8", "x-short-circuit": "1" },
          });
        }
      },
    },
    afterRouteMatch(payload) {
      globalThis.__farmLastRouteMatch = payload;
    },
    afterRender(html, payload) {
      const encode = (value) =>
        JSON.stringify(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return html.replace(
        "</head>",
        '<meta name="farm-reported-route" content="' + encode(payload) + '">' +
          '<meta name="farm-route-match" content="' + encode(globalThis.__farmLastRouteMatch) + '">' +
          "</head>",
      );
    },
  }],
};`,
  );
  await writeModule(
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await writeModule(
    "src/app/page.tsx",
    `import React from "react";
export default function Page() { return <main>home-route</main>; }`,
  );
  await writeModule(
    "src/app/from/page.tsx",
    `import React from "react";
export default function Page() { return <main>from-route</main>; }`,
  );
  await writeModule(
    "src/app/gone/page.tsx",
    `import React from "react";
export default function Page() { return <main>gone-route</main>; }`,
  );
  await writeModule(
    "src/app/short/page.tsx",
    `import React from "react";
export default function Page() { return <main>short-route</main>; }`,
  );
  // A layout only the rewritten route sits under, so the reported layout chain
  // says which route was selected and not merely which URL was rendered.
  await writeModule(
    "src/app/items/layout.tsx",
    `import React from "react";
export default function ItemsLayout({ children }) { return <div data-items-layout="1">{children}</div>; }`,
  );
  await writeModule(
    "src/app/items/[id]/page.tsx",
    `import React from "react";
export default function Page({ params }) { return <main>{"items-route:" + String(params.id)}</main>; }`,
  );

  server = await createServer({ root, images: { provider: "none" } });
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  origin = `http://localhost:${address.port}`;
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("development runtime.before rewrite routing", () => {
  it("routes the page on the pathname the runtime session yields", async () => {
    const response = await fetch(`${origin}/from`);
    const html = await response.text();

    expect(response.status).toBe(200);
    // The rewritten route renders, not the requested one.
    expect(html).toContain("items-route:42");
    expect(html).not.toContain("from-route");
    // The dynamic segment and the nested layout only exist on the rewritten
    // pattern, so both prove the route was selected and not just the URL swapped.
    expect(html).toMatch(/window\.__FARM_PROPS__ = \{"params":\{"id":"42"\}/);
    expect(html).toContain('data-items-layout="1"');
  });

  it("reports the routed route to plugins, matching the production matcher", async () => {
    const response = await fetch(`${origin}/from`);
    const html = await response.text();
    const reported = readReportedRoute(html);

    expect(reported).toEqual({
      pathname: "/items/42",
      method: "GET",
      routePattern: "/items/[id]",
      params: { id: "42" },
    });
    // The selected route, including the layout chain the page actually rendered
    // with, is the rewritten one rather than the requested one.
    expect(readRouteMatch(html)).toEqual({
      pathname: "/items/42",
      matched: true,
      routePattern: "/items/[id]",
      params: { id: "42" },
      layoutPatterns: ["/", "/items"],
    });
    // Pin the reported pattern and params to what a built app resolves for the
    // same rewritten pathname, so the two matchers cannot drift apart.
    expect(prodMatch(String(reported?.routePattern), "/items/42")).toEqual(reported?.params);
  });

  it("does not re-route a request the session left alone", async () => {
    const response = await fetch(`${origin}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("home-route");
    expect(readReportedRoute(html)).toEqual({
      pathname: "/",
      method: "GET",
      routePattern: "/",
      params: {},
    });
    expect(readRouteMatch(html)).toEqual({
      pathname: "/",
      matched: true,
      routePattern: "/",
      params: {},
      layoutPatterns: ["/"],
    });
  });

  it("still short-circuits on a Response without rendering the page", async () => {
    const response = await fetch(`${origin}/short`);
    const body = await response.text();

    expect(response.status).toBe(418);
    expect(response.headers.get("x-short-circuit")).toBe("1");
    expect(body).toBe("short-circuited");
    // No render happened, so no page markup and no afterRender pass.
    expect(body).not.toContain("short-route");
    expect(body).not.toContain("farm-reported-route");
  });

  it("404s on the rewritten pathname when it matches no route", async () => {
    const response = await fetch(`${origin}/gone`);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).not.toContain("gone-route");
  });
});
