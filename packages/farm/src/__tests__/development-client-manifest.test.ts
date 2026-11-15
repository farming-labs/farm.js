// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import type { FarmClientRouteManifest } from "../routing/route-manager";
import {
  createFarmDevClientManifest,
  FARM_DEV_CLIENT_MANIFEST_MODULE,
} from "../server/dev-client-manifest";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
  return filePath;
}

const plan = { version: 1, output: "html", navigation: "html-fragment", hydration: "none" };

function route(pattern: string, extra: Record<string, unknown> = {}) {
  return {
    pattern,
    modulePath: `/src/app${pattern === "/" ? "" : pattern}/page.tsx`,
    shouldHydrate: false,
    isClientComponent: false,
    islandStrategy: null,
    renderPlan: plan,
    segments: pattern
      .split("/")
      .filter(Boolean)
      .map((segment) => ({ segment, isDynamic: false })),
    ...extra,
  } as unknown as FarmClientRouteManifest["routes"][number];
}

function layout(pattern: string) {
  return {
    pattern,
    modulePath: `/src/app${pattern === "/" ? "" : pattern}/layout.tsx`,
    shouldHydrate: false,
    isClientComponent: false,
    islandStrategy: null,
  } as FarmClientRouteManifest["layouts"][number];
}

describe("development client manifest", () => {
  it("keeps the entries a page boots with, and every route Link reads search options from", () => {
    const routes = Array.from({ length: 1000 }, (_, index) => route(`/docs/page-${index}`));
    routes.push(route("/search", { search: { preserve: ["locale"] } }));
    const manifest: FarmClientRouteManifest = {
      routes,
      layouts: [layout("/"), layout("/docs"), layout("/(marketing)"), layout("/blog")],
      slots: [
        {
          name: "modal",
          ownerPattern: "/docs",
          pattern: "/docs/@modal",
          modulePath: "/src/app/docs/@modal/page.tsx",
          containerId: "farm-slot-modal",
          interception: false,
          fallback: false,
          shouldHydrate: false,
          isClientComponent: false,
          segments: [],
        },
        {
          name: "aside",
          ownerPattern: "/blog",
          pattern: "/blog/@aside",
          modulePath: "/src/app/blog/@aside/page.tsx",
          containerId: "farm-slot-aside",
          interception: false,
          fallback: false,
          shouldHydrate: false,
          isClientComponent: false,
          segments: [],
        },
      ],
    };

    const full = createFarmDevClientManifest(manifest, { sharedAssets: [] });
    expect(Object.keys(full.routes)).toHaveLength(1001);
    expect(full.module).toBeUndefined();
    // A grouped layout matches its URL and stays inside its group, as production's does.
    expect(full.layouts["/(marketing)"]).toMatchObject({
      urlPattern: "/",
      groupScope: "/(marketing)",
    });

    const boot = createFarmDevClientManifest(manifest, {
      sharedAssets: [],
      boot: { routePattern: "/docs/page-500", layoutPatterns: ["/", "/docs"] },
    });
    expect(boot.module).toBe(FARM_DEV_CLIENT_MANIFEST_MODULE);
    expect(Object.keys(boot.routes)).toEqual(["/docs/page-500", "/search"]);
    expect(boot.routes["/docs/page-500"]).toEqual(full.routes["/docs/page-500"]);
    expect(Object.keys(boot.layouts)).toEqual(["/", "/docs"]);
    expect(boot.slots.map((slot) => slot.name)).toEqual(["modal"]);
    expect(JSON.stringify(boot).length).toBeLessThan(JSON.stringify(full).length / 100);
  });

  it("inlines only the current route in dev HTML and serves every route from the module", async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-client-manifest-")),
    );
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(
      await fs.realpath(packageRoot),
      path.join(root, "node_modules", "@farm.js", "core"),
      "junction",
    );
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "src/app/layout.tsx",
      `export default function Layout({ children }) { return <main>{children}</main>; }`,
    );
    await writeModule(
      root,
      "src/app/docs/layout.tsx",
      `export default function DocsLayout({ children }) { return <section>{children}</section>; }`,
    );
    const pageCount = 40;
    for (let index = 0; index < pageCount; index++) {
      await writeModule(
        root,
        `src/app/docs/page-${index}/page.tsx`,
        `export default function Page() { return <h1>Doc ${index}</h1>; }`,
      );
    }

    const server = await createServer({
      root,
      images: { provider: "none" },
      vite: { optimizeDeps: { noDiscovery: true, include: [] } },
    } as never);
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    const html = await (await fetch(`${origin}/docs/page-7`)).text();
    expect(html).toContain("Doc 7");
    const inlined = JSON.parse(html.match(/window\.__FARM_MANIFEST__ = (.*);\n/)![1]!);
    // Before: every route's entry, so each document grew with the app.
    expect(Object.keys(inlined.routes)).toEqual(["/docs/page-7"]);
    expect(Object.keys(inlined.layouts).sort()).toEqual(["/", "/docs"]);
    expect(inlined.module).toBe("/@farm/manifest");

    const readModule = async () => {
      const response = await fetch(`${origin}${inlined.module}`);
      expect(response.status).toBe(200);
      const code = await response.text();
      // Without a source map, which would repeat the manifest several times over.
      expect(code).not.toContain("sourceMappingURL");
      const json = code.match(/JSON\.parse\((".*")\)/)![1]!;
      return JSON.parse(JSON.parse(json)) as { routes: Record<string, unknown> };
    };
    const full = await readModule();
    expect(Object.keys(full.routes)).toHaveLength(pageCount);
    expect(full.routes["/docs/page-7"]).toEqual(inlined.routes["/docs/page-7"]);

    // A page added while the server runs: the route refresh reloads open pages, whose client
    // reads the new route from the module.
    const send = vi.spyOn(server.ws, "send");
    await writeModule(
      root,
      "src/app/docs/added/page.tsx",
      `export default function Page() { return <h1>Added</h1>; }`,
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "full-reload", path: "*" }), {
      timeout: 20_000,
      interval: 50,
    });
    expect(Object.keys((await readModule()).routes)).toContain("/docs/added");
    const addedHtml = await (await fetch(`${origin}/docs/added`)).text();
    expect(addedHtml).toContain("Added");
    expect(
      Object.keys(JSON.parse(addedHtml.match(/window\.__FARM_MANIFEST__ = (.*);\n/)![1]!).routes),
    ).toEqual(["/docs/added"]);
  }, 60_000);
});
