// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAst } from "rolldown/parseAst";
import { resolveConfig, type FarmUserConfig, type ResolvedFarmConfig } from "../config";
import { loadFarmMobileRuntime } from "../config-runtime";
import { stripPlatformConfigSource } from "../build/strip-platform-config";
import {
  createFarmMobileContext,
  resolveFarmMobileBlock,
  resolveFarmMobileConfig,
  validateFarmMobileConfig,
  type FarmMobileBlockCache,
  type FarmMobileContext,
} from "../mobile/config";
import { createFarmMobileRouteManifest, createFarmMobileRoutePattern } from "../mobile/routes";
import { platform } from "../platform";
import { createFarmRouter } from "../router";
import { farmServerOnlyEntriesPlugin } from "../vite";

const roots: string[] = [];
const previousPlatform = process.env.FARM_PLATFORM;

function setPlatform(value: string | undefined) {
  if (value === undefined) delete process.env.FARM_PLATFORM;
  else process.env.FARM_PLATFORM = value;
}

beforeEach(() => setPlatform(undefined));
afterEach(async () => {
  setPlatform(previousPlatform);
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const PAGE = "export default function Page() { return null; }\n";

/** An app with static, dynamic, catch-all, optional catch-all, grouped, and slot routes. */
async function createApp(extra: Record<string, string> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-mobile-config-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "@acme/notes-app", version: "1.2.3" }),
    "src/app/layout.tsx": "export default function Layout({ children }) { return children; }\n",
    "src/app/page.tsx": PAGE,
    "src/app/notes/page.tsx": PAGE,
    "src/app/notes/new/page.tsx": PAGE,
    "src/app/notes/[id]/page.tsx": PAGE,
    "src/app/notes/[id]/edit/page.tsx": PAGE,
    "src/app/docs/[...slug]/page.tsx": PAGE,
    "src/app/shop/[[...filters]]/page.tsx": PAGE,
    "src/app/(account)/settings/page.tsx": PAGE,
    "src/app/(account)/layout.tsx":
      "export default function Layout({ children }) { return children; }\n",
    "src/app/feed/page.tsx": PAGE,
    "src/app/notes/@sidebar/page.tsx": PAGE,
    "src/native/feed.tsx": "export default function Feed() { return null; }\n",
    ...extra,
  };
  for (const [file, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  return root;
}

const ROUTES = [
  "/",
  "/notes",
  "/notes/new",
  "/notes/[id]",
  "/notes/[id]/edit",
  "/docs/[...slug]",
  "/shop/[[...filters]]",
  "/settings",
  "/feed",
];

const build = { os: "android", command: "build" } as const;
const dev = { os: "android", command: "dev" } as const;

describe("mobile config", () => {
  it("rejects malformed blocks with the option name", () => {
    expect(() => validateFarmMobileConfig("Notes")).toThrow(/^mobile: must be an object/);
    expect(() => validateFarmMobileConfig({ shell: "x" })).toThrow(
      /unknown option shell\. Supported: name, id, server, tabs, routes/,
    );
    expect(() => validateFarmMobileConfig({ id: "notes" })).toThrow(/id must be a reverse-DNS/);
    expect(() => validateFarmMobileConfig({ id: "com.my-app.notes" })).toThrow(
      /letters and digits/,
    );
    expect(() => validateFarmMobileConfig({ id: "com.example.new" })).toThrow(
      /"new" is a Java keyword/,
    );
    expect(validateFarmMobileConfig({ id: "dev.farmjs.notes2" })).toEqual({
      id: "dev.farmjs.notes2",
    });

    expect(() =>
      validateFarmMobileConfig({ tabs: [{ path: "/notes/[id]", title: "N", icon: "n" }] }),
    ).toThrow(/tabs\[0\]\.path must be a static route/);
    expect(() =>
      validateFarmMobileConfig({ tabs: [{ path: "notes", title: "N", icon: "n" }] }),
    ).toThrow(/tabs\[0\]\.path must be a route path/);
    expect(() =>
      validateFarmMobileConfig({
        tabs: [
          { path: "/", title: "A", icon: "a" },
          { path: "/", title: "B", icon: "b" },
        ],
      }),
    ).toThrow(/tabs\[1\]\.path "\/" is already a tab/);
    expect(() =>
      validateFarmMobileConfig({ tabs: [{ path: "/", title: " ", icon: "a" }] }),
    ).toThrow(/tabs\[0\]\.title must be a non-empty string/);
    expect(() =>
      validateFarmMobileConfig({ tabs: [{ path: "/", title: "A", icon: "../x.png" }] }),
    ).toThrow(/tabs\[0\]\.icon must be an icon name/);
    expect(() =>
      validateFarmMobileConfig({
        tabs: Array.from({ length: 6 }, (_, index) => ({
          path: `/t${index}`,
          title: "T",
          icon: "t",
        })),
      }),
    ).toThrow(/at most 5/);

    expect(() =>
      validateFarmMobileConfig({ routes: { "/notes": { presentation: "sheet" } } }),
    ).toThrow(/routes\["\/notes"\]\.presentation must be "push", "modal", or "replace"/);
    expect(() =>
      validateFarmMobileConfig({ routes: { "/feed": { native: "./src/native/feed.tsx" } } }),
    ).toThrow(/routes\["\/feed"\]\.native must name a module in src\/native\//);
    expect(() => validateFarmMobileConfig({ routes: { feed: {} } })).toThrow(
      /the key must be an app route/,
    );
    expect(() => validateFarmMobileConfig({ routes: { "/feed": { tab: 1 } } })).toThrow(
      /unknown option routes\["\/feed"\]\.tab/,
    );
  });

  it("allows http:// only for loopback and LAN hosts in dev", () => {
    expect(validateFarmMobileConfig({ server: "https://notes.example.com" }, build)).toBeTruthy();
    for (const server of [
      "http://10.0.2.2:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://192.168.1.20:3000",
      "http://172.20.0.4:3000",
      "http://my-mac.local:3000",
      "http://[::1]:3000",
    ]) {
      expect(validateFarmMobileConfig({ server }, dev), server).toBeTruthy();
    }
    expect(() => validateFarmMobileConfig({ server: "http://10.0.2.2:3000" }, build)).toThrow(
      /mobile \(os: android\): server must use https:\/\/ in a build/,
    );
    expect(() => validateFarmMobileConfig({ server: "http://notes.example.com" }, dev)).toThrow(
      /http:\/\/ only for a loopback or LAN host/,
    );
    expect(() => validateFarmMobileConfig({ server: "http://172.32.0.1" }, dev)).toThrow(
      /loopback or LAN/,
    );
    expect(() => validateFarmMobileConfig({ server: "notes.example.com" }, build)).toThrow(
      /server must be an absolute URL/,
    );
    expect(() => validateFarmMobileConfig({ server: "https://x.dev/app" }, build)).toThrow(
      /without a path, query, or credentials/,
    );
    expect(() => validateFarmMobileConfig({ server: "https://u:p@x.dev" }, build)).toThrow(
      /without a path/,
    );
    expect(() => validateFarmMobileConfig({ server: "ftp://x.dev" }, build)).toThrow(
      /must use https:\/\//,
    );
  });

  it("checks tabs and routes against the app's routes and native modules", async () => {
    const root = await createApp();
    const resolve = (input: Parameters<typeof resolveFarmMobileConfig>[0]) =>
      resolveFarmMobileConfig(input, { root, routes: ROUTES }, build);

    expect(resolve({ server: "https://notes.example.com/" })).toEqual({
      name: "notes-app",
      id: "local.farm.notesapp",
      server: "https://notes.example.com",
      tabs: [],
      routes: {},
    });
    // A default id from an app named like a Java keyword says to set one.
    expect(() => resolve({ name: "Class" })).toThrow(
      /"class" is a Java keyword.*set mobile\.id, such as "com\.example\.notes"/,
    );
    expect(() => resolve({ tabs: [{ path: "/inbox", title: "Inbox", icon: "inbox" }] })).toThrow(
      /mobile \(os: android\): tabs\[0\]\.path "\/inbox" is not a page route\. Add src\/app\/inbox\/page\.tsx/,
    );
    expect(() => resolve({ routes: { "/notes/[noteId]": { presentation: "modal" } } })).toThrow(
      /routes\["\/notes\/\[noteId\]"\] is not a page route; did you mean "\/notes\/\[id\]"\?/,
    );
    expect(() => resolve({ routes: { "/missing": {} } })).toThrow(/is not a page route\. Keys/);
    expect(() =>
      resolve({
        tabs: [{ path: "/notes", title: "Notes", icon: "notes" }],
        routes: { "/notes": { presentation: "modal" } },
      }),
    ).toThrow(/presentation does not apply to a tab route/);
    expect(() => resolve({ routes: { "/notes": { native: "notes" } } })).toThrow(
      /routes\["\/notes"\]\.native "notes" needs src\/native\/notes\.tsx, which was not found/,
    );
    // A group in the key is the same URL pattern.
    expect(
      resolve({ routes: { "/(account)/settings": { presentation: "modal" } } }).routes,
    ).toEqual({ "/settings": { presentation: "modal" } });
    expect(resolve({ routes: { "/feed": { native: "feed" } } }).routes).toEqual({
      "/feed": { native: "feed" },
    });
  });

  it("resolves a static block, a sync function, and an async function", async () => {
    const root = await createApp();
    const context = createFarmMobileContext({ command: "build", root, mode: "production" });
    expect(context).toMatchObject({ os: "android", command: "build", profile: "production" });
    expect(Object.isFrozen(context.env)).toBe(true);

    const block = { id: "com.example.notes", server: "https://notes.example.com" };
    expect(await resolveFarmMobileBlock(block, context)).toEqual(block);
    expect(await resolveFarmMobileBlock(() => block, context)).toEqual(block);
    expect(
      await resolveFarmMobileBlock(async ({ os, profile }) => ({ name: `${os}-${profile}` }), {
        ...context,
        os: "ios",
        profile: "beta",
      }),
    ).toEqual({ name: "ios-beta" });

    expect(() =>
      createFarmMobileContext({ command: "build", root, mode: "production", os: "macos" as never }),
    ).toThrow(/--os must be android or ios/);
    expect(() =>
      createFarmMobileContext({ command: "build", root, mode: "production", profile: "../x" }),
    ).toThrow(/--profile must be a name/);
    expect(() =>
      createFarmMobileContext({ command: "serve" as never, root, mode: "production" }),
    ).toThrow(/--command must be dev or build/);
  });

  it("calls a function once per OS and session, and names the OS when it returns bad values", async () => {
    const root = await createApp();
    const seen: FarmMobileContext[] = [];
    const mobile = (context: FarmMobileContext) => {
      seen.push(context);
      return {
        id: context.os === "ios" ? "com.example.notes.ios" : "com.example.notes",
        server: context.command === "dev" ? "http://10.0.2.2:3000" : "https://notes.example.com",
      };
    };
    const cache: FarmMobileBlockCache = new Map();
    const android = createFarmMobileContext({ command: "dev", root, mode: "development" });
    const ios = createFarmMobileContext({ command: "dev", root, mode: "development", os: "ios" });
    expect(await resolveFarmMobileBlock(mobile, android, cache)).toEqual({
      id: "com.example.notes",
      server: "http://10.0.2.2:3000",
    });
    await resolveFarmMobileBlock(mobile, android, cache);
    expect((await resolveFarmMobileBlock(mobile, ios, cache)).id).toBe("com.example.notes.ios");
    expect(seen.map((context) => context.os)).toEqual(["android", "ios"]);

    const buildContext = createFarmMobileContext({ command: "build", root, mode: "production" });
    await expect(
      resolveFarmMobileBlock(() => ({ server: "http://10.0.2.2:3000" }), buildContext),
    ).rejects.toThrow(/^mobile \(os: android\): server must use https:\/\/ in a build/);
    await expect(resolveFarmMobileBlock(async () => null as never, buildContext)).rejects.toThrow(
      /mobile \(os: android\): the function must return an object/,
    );
  });
});

describe("mobile route manifest", () => {
  it("generates farm-routes.json from the app directory with tabs, modals, and native screens", async () => {
    const root = await createApp();
    const { generateFarmMobileRoutes } = await loadFarmMobileRuntime();
    const result = await generateFarmMobileRoutes({
      root,
      userConfig: {
        telemetry: false,
        mobile: {
          id: "com.example.notes",
          server: "https://notes.example.com",
          tabs: [
            { path: "/notes", title: "Notes", icon: "note.text" },
            { path: "/settings", title: "Settings", icon: "gear" },
          ],
          routes: {
            "/notes/new": { presentation: "modal" },
            "/notes/[id]/edit": { presentation: "replace" },
            "/feed": { native: "feed" },
          },
        },
      },
    });
    expect(await fs.realpath(result.file)).toBe(
      path.join(await fs.realpath(root), ".farm", "output", "mobile", "farm-routes.json"),
    );
    const manifest = JSON.parse(await fs.readFile(result.file, "utf8"));
    expect(manifest).toEqual({
      version: 1,
      server: "https://notes.example.com",
      tabs: [
        { path: "/notes", title: "Notes", icon: "note.text" },
        { path: "/settings", title: "Settings", icon: "gear" },
      ],
      // Most specific first, as the client router orders routes.
      rules: [
        { route: "/notes/new", pattern: "^/notes/new/?$", presentation: "modal" },
        {
          route: "/notes/[id]/edit",
          pattern: "^/notes/[^/]+/edit/?$",
          presentation: "replace",
        },
        { route: "/notes/[id]", pattern: "^/notes/[^/]+/?$", presentation: "push" },
        {
          route: "/feed",
          pattern: "^/feed/?$",
          presentation: "push",
          screen: "native",
          module: "feed",
        },
        { route: "/notes", pattern: "^/notes/?$", presentation: "tab", tab: 0 },
        { route: "/settings", pattern: "^/settings/?$", presentation: "tab", tab: 1 },
        { route: "/docs/[...slug]", pattern: "^/docs(?:/[^/]+)+/?$", presentation: "push" },
        { route: "/shop/[[...filters]]", pattern: "^/shop(?:/[^/]+)*/?$", presentation: "push" },
        { route: "/", pattern: "^/?$", presentation: "push" },
        { pattern: "^/", presentation: "push" },
      ],
    });
    // The slot page and the route group add no rule.
    expect(JSON.stringify(manifest)).not.toMatch(/@sidebar|\(account\)/);
  });

  it("picks the same route as the client router for every path", () => {
    const manifest = createFarmMobileRouteManifest(
      { name: "n", id: "a.b", server: "https://x.dev", tabs: [], routes: {} },
      { routes: ROUTES },
    );
    const router = createFarmRouter(ROUTES);
    const rules = manifest.rules.map((rule) => ({ ...rule, regex: new RegExp(rule.pattern) }));
    for (const pathname of [
      "/",
      "/notes",
      "/notes/",
      "/notes/new",
      "/notes/42",
      "/notes/42/edit",
      "/notes/42/other",
      "/docs",
      "/docs/a",
      "/docs/a/b/c",
      "/shop",
      "/shop/red/large",
      "/settings",
      "/api/notes",
      "/feed/extra",
    ]) {
      const rule = rules.find((candidate) => candidate.regex.test(pathname))!;
      expect(rule.route ?? null, pathname).toBe(router.match(pathname)?.route.path ?? null);
    }
  });

  it("never reads a locale as a dynamic first segment", () => {
    // The client router strips the locale before matching, so `/fr` is the French home page.
    const routes = ["/", "/[slug]", "/[a]/[b]"];
    const i18n = { locales: ["en", "fr"], routing: "prefix-except-default" as const };
    const manifest = createFarmMobileRouteManifest(
      { name: "n", id: "a.b", server: "https://x.dev", tabs: [], routes: {} },
      { routes, i18n },
    );
    const rules = manifest.rules.map((rule) => ({ ...rule, regex: new RegExp(rule.pattern) }));
    const routeFor = (pathname: string) =>
      rules.find((candidate) => candidate.regex.test(pathname))?.route ?? null;
    expect(routeFor("/fr")).toBe("/");
    expect(routeFor("/FR/")).toBe("/");
    expect(routeFor("/fr/x")).toBe("/[slug]");
    expect(routeFor("/x")).toBe("/[slug]");
    expect(routeFor("/fr/fr")).toBe("/[slug]");
    expect(routeFor("/fr/x/y")).toBe("/[a]/[b]");
    expect(routeFor("/x/y")).toBe("/[a]/[b]");
    expect(routeFor("/english")).toBe("/[slug]");
  });

  it("puts the base path and an optional locale prefix in front of every rule", () => {
    const options = {
      basePath: "/app.v2/",
      i18n: { locales: ["en", "pt-BR"], routing: "prefix-except-default" as const },
    };
    const source = createFarmMobileRoutePattern("/notes/[id]", options);
    expect(source).toBe(
      "^/app\\.v2(?:/(?:[Ee][Nn]|[Pp][Tt]-[Bb][Rr])|(?!/(?:[Ee][Nn]|[Pp][Tt]-[Bb][Rr])(?:/|$)))/notes/[^/]+/?$",
    );
    const notes = new RegExp(source);
    for (const pathname of ["/app.v2/notes/1", "/app.v2/en/notes/1", "/app.v2/PT-br/notes/1/"]) {
      expect(notes.test(pathname), pathname).toBe(true);
    }
    for (const pathname of ["/notes/1", "/appXv2/notes/1", "/app.v2/fr/notes/1"]) {
      expect(notes.test(pathname), pathname).toBe(false);
    }
    const root = new RegExp(createFarmMobileRoutePattern("/", options));
    expect(["/app.v2", "/app.v2/", "/app.v2/en"].every((value) => root.test(value))).toBe(true);
    expect(
      createFarmMobileRoutePattern("/notes", {
        i18n: { locales: ["en"], routing: "none" },
      }),
    ).toBe("^/notes/?$");
    // Static segments match decoded paths and escape regex syntax.
    expect(createFarmMobileRoutePattern("/caf%C3%A9/a+b")).toBe("^/café/a\\+b/?$");

    const manifest = createFarmMobileRouteManifest(
      {
        name: "n",
        id: "a.b",
        tabs: [
          { path: "/", title: "Home", icon: "home" },
          { path: "/notes", title: "Notes", icon: "notes" },
        ],
        routes: {},
      },
      { routes: ["/", "/notes"], server: "http://10.0.2.2:3000", basePath: "/app" },
    );
    expect(manifest.server).toBe("http://10.0.2.2:3000");
    expect(manifest.tabs.map((tab) => tab.path)).toEqual(["/app", "/app/notes"]);
  });

  it("needs a server and a mobile entry", async () => {
    const root = await createApp();
    const { resolveFarmMobileApp } = await loadFarmMobileRuntime();
    await expect(resolveFarmMobileApp({ root, userConfig: { telemetry: false } })).rejects.toThrow(
      /farm\.config\.ts has no `mobile` entry/,
    );
    await expect(
      resolveFarmMobileApp({ root, command: "dev", userConfig: { mobile: { id: "a.b" } } }),
    ).rejects.toThrow(/mobile \(os: android\): server is required/);
    // farm dev --mobile passes the dev server's address instead.
    const app = await resolveFarmMobileApp({
      root,
      command: "dev",
      server: "http://192.168.1.20:3000",
      userConfig: { mobile: { id: "a.b" } },
    });
    expect(app.manifest.server).toBe("http://192.168.1.20:3000");
    await expect(
      resolveFarmMobileApp({
        root,
        server: "http://192.168.1.20:3000",
        userConfig: { mobile: { id: "a.b" } },
      }),
    ).rejects.toThrow(/the server URL must use https:\/\/ in a build/);
  });
});

/** Everything a build reads from the resolved config, with functions and the build id dropped. */
function fingerprint(config: ResolvedFarmConfig): string {
  const { deploymentId: _deploymentId, generateBuildId: _generateBuildId, ...rest } = config;
  return JSON.stringify(rest, (_key, value) => (typeof value === "function" ? "fn" : value));
}

describe("mobile on the web", () => {
  it("resolves the same web config with or without a mobile block and never calls the function", async () => {
    const root = await createApp();
    const base: FarmUserConfig = { root, deploymentId: "fixed" };
    const without = await resolveConfig(base, "production");
    let calls = 0;
    for (const mobile of [
      // Malformed on purpose: a web build does not check the block.
      { id: "not an id", server: "http://example.com" },
      () => {
        calls += 1;
        return { id: "com.example.notes" };
      },
    ]) {
      const withMobile = await resolveConfig({ ...base, mobile } as FarmUserConfig, "production");
      expect(fingerprint(withMobile)).toBe(fingerprint(without));
      expect(withMobile).not.toHaveProperty("mobile");
    }
    expect(calls).toBe(0);
  });

  it("strips the mobile entry from the config a server bundle imports", () => {
    const parse = (code: string) => parseAst(code);
    expect(
      stripPlatformConfigSource(
        `export default defineConfig({ desktop: { name: "x" }, plugins: [a], mobile: async ({ os }) => ({ id: os }) });`,
        parse,
      ),
    ).toBe("export default defineConfig({ plugins: [a] });");
    expect(stripPlatformConfigSource(`export default { mobile: { id: "a.b" } };`, parse)).toBe(
      "export default {  };",
    );
    // Adjacent platform entries, at the end, at the start, and as the whole config.
    expect(
      stripPlatformConfigSource(
        `export default { a: 1, desktop: { name: "x" }, mobile: { id: "a.b" }, };`,
        parse,
      ),
    ).toBe("export default { a: 1, };");
    expect(
      stripPlatformConfigSource(`export default { mobile: {}, desktop: {}, a: 1 };`, parse),
    ).toBe("export default { a: 1 };");
    expect(stripPlatformConfigSource(`export default { desktop: {}, mobile: {}, };`, parse)).toBe(
      "export default {  };",
    );
    expect(stripPlatformConfigSource(`export default { theme: { mobile: 1 } };`, parse)).toBeNull();
  });

  it("reports mobile from platform() and in browser code under FARM_PLATFORM=mobile", () => {
    expect(platform()).toBe("web");
    setPlatform("mobile");
    expect(platform()).toBe("mobile");
    const plugin = farmServerOnlyEntriesPlugin() as any;
    const id = plugin.resolveId("@farm.js/core/platform", "/app/page.tsx", { ssr: false });
    expect(plugin.load(id)).toContain('return "mobile";');
    setPlatform("other");
    expect(platform()).toBe("web");
  });
});
