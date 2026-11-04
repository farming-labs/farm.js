// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ResolvedFarmMobileConfig } from "../mobile/config";
import {
  createFarmMobilePageShell,
  getFarmMobilePageShellFile,
  renderFarmMobilePageShells,
} from "../mobile/page-shells";
import { createFarmMobileRouteManifest } from "../mobile/routes";
import {
  FARM_SHELL_PARAM_SEGMENT,
  _checkFarmMobileShellRoute,
  _isFarmMobileShellRenderRequest,
  createFarmMobileShellRenderPath,
} from "../mobile/shell-render";

const TOKEN = "t".repeat(43);

const DOCUMENT = [
  "<!DOCTYPE html>",
  '<html lang="en"><head>',
  '<meta charset="utf-8"><title>Notes</title>',
  '<link rel="stylesheet" href="/assets/farm-client-h1a2b3c4d.css" media="screen">',
  '<link rel="modulepreload" href="/chunks/notes-h5e6f7a8b.js">',
  '<link rel="preload" as="script" href="/chunks/other-h99999999.js">',
  '<link rel="preload" as="font" href="/assets/inter-h12345678.woff2" crossorigin>',
  '<link rel="icon" href="/favicon.ico">',
  "<script>window.__FARM_DATA__ = {};</script>",
  "</head><body>",
  '<div id="__farm_page__"><p class="skeleton">Loading notes</p></div>',
  '<SCRIPT type="module" src="/farm-mobile-client-h0f0f0f0f.js"></SCRIPT>',
  "</body></html>",
].join("");

describe("page shell requests", () => {
  it("only accept this build's token", () => {
    const request = (value?: string) =>
      new Request("http://127.0.0.1/notes", {
        headers: value === undefined ? {} : { "X-Farm-Shell-Render": value },
      });
    expect(_isFarmMobileShellRenderRequest(request(TOKEN), TOKEN)).toBe(true);
    expect(_isFarmMobileShellRenderRequest(request(`${TOKEN.slice(1)}x`), TOKEN)).toBe(false);
    expect(_isFarmMobileShellRenderRequest(request("short"), TOKEN)).toBe(false);
    expect(_isFarmMobileShellRenderRequest(request(), TOKEN)).toBe(false);
    // A server built without a token never renders shells.
    expect(_isFarmMobileShellRenderRequest(request(""), "")).toBe(false);
  });

  it("render a shell only from a loading file and layouts in static folders", () => {
    const check = (overrides: Partial<Parameters<typeof _checkFarmMobileShellRoute>[0]>) =>
      _checkFarmMobileShellRoute({
        requested: "/notes/[id]",
        route: "/notes/[id]",
        layouts: ["/", "/notes"],
        loading: "/notes",
        ...overrides,
      });
    expect(check({})).toBeNull();
    // Route groups are folders without a URL segment.
    expect(
      check({ route: "/(app)/notes/[id]", layouts: ["/", "/(app)"], loading: "/(app)" }),
    ).toBeNull();
    expect(check({ loading: null })).toBe("it has no loading file");
    expect(check({ loading: "/notes/[id]" })).toBe(
      "its loading file is in a dynamic folder (/notes/[id])",
    );
    expect(check({ layouts: ["/", "/notes/[id]"] })).toBe(
      "a layout is in a dynamic folder (/notes/[id])",
    );
    // A request that matched a more specific route, or none was asked for.
    expect(check({ requested: "/notes/[slug]" })).toMatch(/matched \/notes\/\[id\], not/);
    expect(check({ requested: null })).toMatch(/not a requested route/);
  });

  it("stand in for every dynamic segment so the request matches the route", () => {
    expect(createFarmMobileShellRenderPath("/")).toBe("/");
    expect(createFarmMobileShellRenderPath("/notes")).toBe("/notes");
    expect(createFarmMobileShellRenderPath("/notes/[id]/edit")).toBe(
      `/notes/${FARM_SHELL_PARAM_SEGMENT}/edit`,
    );
    expect(createFarmMobileShellRenderPath("/docs/[...slug]")).toBe(
      `/docs/${FARM_SHELL_PARAM_SEGMENT}`,
    );
    expect(createFarmMobileShellRenderPath("/shop/[[...filters]]")).toBe("/shop");
    expect(createFarmMobileShellRenderPath("/(account)/settings")).toBe("/settings");
  });
});

describe("page shells", () => {
  it("drop every script and script preload and keep markup and styles", () => {
    const shell = createFarmMobilePageShell(DOCUMENT, { os: "android" });
    expect(shell).not.toMatch(/<script/i);
    expect(shell).not.toMatch(/modulepreload|other-h99999999|__FARM_DATA__/);
    expect(shell).toContain('<link rel="stylesheet" href="/assets/farm-client-h1a2b3c4d.css"');
    expect(shell).toContain('as="font"');
    expect(shell).toContain('<link rel="icon" href="/favicon.ico">');
    expect(shell).toContain('<p class="skeleton">Loading notes</p>');
    expect(shell).toContain('<html lang="en" data-farm-page-shell>');
    // Marking a shell twice changes nothing.
    expect(createFarmMobilePageShell(shell, { os: "android" })).toBe(shell);
  });

  it("inline the build's stylesheets on iOS", () => {
    const read = (href: string) =>
      href === "/assets/farm-client-h1a2b3c4d.css"
        ? '.a{content:"</style><script>x</script>"}'
        : undefined;
    const shell = createFarmMobilePageShell(DOCUMENT, { os: "ios", readStylesheet: read });
    expect(shell).not.toContain("farm-client-h1a2b3c4d.css");
    // Only </style ends a style element; the rest of its text is never markup.
    expect(shell).toContain(
      '<style media="screen">.a{content:"<\\/style><script>x</script>"}</style>',
    );
    expect(shell.match(/<\/style>/g)).toHaveLength(1);
    // A stylesheet the build did not write stays a link.
    const other = createFarmMobilePageShell(
      '<html><head><link rel="stylesheet" href="https://cdn.example.com/x.css"></head></html>',
      { os: "ios", readStylesheet: read },
    );
    expect(other).toContain('href="https://cdn.example.com/x.css"');
    // Android loads it from the app instead.
    expect(createFarmMobilePageShell(DOCUMENT, { os: "android", readStylesheet: read })).toContain(
      'href="/assets/farm-client-h1a2b3c4d.css"',
    );
  });

  it("name each shell by its content", () => {
    const file = getFarmMobilePageShellFile("<html></html>");
    expect(file).toMatch(/^[0-9a-f]{16}\.html$/);
    expect(getFarmMobilePageShellFile("<html></html>")).toBe(file);
    expect(getFarmMobilePageShellFile("<html> </html>")).not.toBe(file);
  });

  it("ask the build's server for every route and keep what it renders", async () => {
    const requests: { path: string; headers: Record<string, string> }[] = [];
    const notes = '<html><body><p>Loading notes</p><script src="/a.js"></script></body></html>';
    const result = await renderFarmMobilePageShells({
      os: "android",
      routes: ["/notes/[id]", "/notes", "/settings", "/login-only", "/missing", "/notes"],
      token: TOKEN,
      basePath: "/app",
      client: "/farm-mobile-client-h0f0f0f0f.js",
      concurrency: 2,
      fetch: async (path, init) => {
        requests.push({ path, ...init });
        const html = { "Content-Type": "text/html; charset=utf-8" };
        switch (path) {
          case "/app/notes":
          case `/app/notes/${FARM_SHELL_PARAM_SEGMENT}`:
            return new Response(notes, { headers: html });
          case "/app/settings":
            return new Response("it has no loading file", {
              status: 404,
              headers: { "X-Farm-Shell-Render": "none" },
            });
          case "/app/login-only":
            return new Response(null, { status: 307, headers: { Location: "/app/login" } });
          default:
            return new Response("<html>Not found</html>", { status: 404, headers: html });
        }
      },
    });
    expect(requests.map((request) => request.path).sort()).toEqual([
      "/app/login-only",
      "/app/missing",
      "/app/notes",
      `/app/notes/${FARM_SHELL_PARAM_SEGMENT}`,
      "/app/settings",
    ]);
    expect(requests.find((request) => request.path === "/app/notes")!.headers).toEqual({
      Accept: "text/html",
      "X-Farm-Shell": "android",
      "X-Farm-Shell-Render": TOKEN,
      "X-Farm-Shell-Route": "/notes",
    });
    const file = getFarmMobilePageShellFile(
      "<html data-farm-page-shell><body><p>Loading notes</p></body></html>",
    );
    // Both notes routes render the same shell, so they share its file.
    expect(result.shells).toEqual({
      client: "/farm-mobile-client-h0f0f0f0f.js",
      routes: { "/notes": file, "/notes/[id]": file },
      files: { [file]: "<html data-farm-page-shell><body><p>Loading notes</p></body></html>" },
    });
    expect(result.skipped).toEqual([
      { route: "/login-only", reason: "the server answered 307 (to /app/login)" },
      { route: "/missing", reason: "the server answered 404" },
      { route: "/settings", reason: "it has no loading file" },
    ]);
  });
});

describe("the route manifest", () => {
  const mobile: ResolvedFarmMobileConfig = {
    name: "Notes",
    id: "com.example.notes",
    server: "https://notes.example.com",
    tabs: [],
    routes: {},
    native: {
      engine: "react-native",
      auto: "report",
      routes: {},
      islands: [],
      prefetch: "intent",
      budgets: {},
    },
    shells: true,
  };

  it("maps routes to their shells and carries nothing else of them", () => {
    const shells = {
      client: "/farm-mobile-client-h0f0f0f0f.js",
      routes: { "/notes": "0123456789abcdef.html" },
      files: { "0123456789abcdef.html": "<html></html>" },
    };
    const manifest = createFarmMobileRouteManifest(mobile, { routes: ["/notes"], shells });
    expect(manifest.shells).toEqual({
      client: "/farm-mobile-client-h0f0f0f0f.js",
      routes: { "/notes": "0123456789abcdef.html" },
    });
    expect(
      createFarmMobileRouteManifest(mobile, {
        routes: ["/notes"],
        shells: { client: shells.client, routes: {} },
      }),
    ).not.toHaveProperty("shells");
    expect(createFarmMobileRouteManifest(mobile, { routes: ["/notes"] })).not.toHaveProperty(
      "shells",
    );
  });
});
