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
  type ResolvedFarmMobileNativeConfig,
} from "../mobile/config";
import { createFarmMobileRouteManifest, createFarmMobileRoutePattern } from "../mobile/routes";
import { platform } from "../platform";
import { createFarmRouter } from "../router";
import { createRouteTypeDeclarations, scanRoutePatterns } from "../routing/generate-route-types";
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
const NATIVE: ResolvedFarmMobileNativeConfig = {
  engine: "react-native",
  auto: "report",
  routes: {},
  islands: [],
  prefetch: "intent",
  budgets: {},
};
const dev = { os: "android", command: "dev" } as const;

describe("mobile config", () => {
  it("rejects malformed blocks with the option name", () => {
    expect(() => validateFarmMobileConfig("Notes")).toThrow(/^mobile: must be an object/);
    expect(() => validateFarmMobileConfig({ shell: "x" })).toThrow(
      /unknown option shell\. Supported: name, id, server, tabs, routes, native/,
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
    expect(() => validateFarmMobileConfig({ routes: { feed: {} } })).toThrow(
      /the key must be an app route/,
    );
    expect(() => validateFarmMobileConfig({ routes: { "/feed": { tab: 1 } } as never })).toThrow(
      /unknown option routes\["\/feed"\]\.tab\. Supported: presentation/,
    );

    const routes = (value: unknown) =>
      validateFarmMobileConfig({ native: { routes: value } } as never);
    expect(() => routes({ "/notes": { screen: "web", presentation: "sheet" } })).toThrow(
      /native\.routes\["\/notes"\]\.presentation must be "push", "modal", or "replace"/,
    );
    expect(() => routes({ feed: { screen: "web" } })).toThrow(/the key must be an app route/);
    expect(() => routes({ "/feed": { screen: "web", tab: 1 } })).toThrow(
      /unknown option native\.routes\["\/feed"\]\.tab\. Supported: screen, android, ios, presentation/,
    );
    expect(() => routes({ "/feed": { ios: "web" } })).toThrow(
      /native\.routes\["\/feed"\]\.screen is required: "web", "native", or "platform"/,
    );
    expect(() => routes({ "/feed": { screen: "rn" } })).toThrow(
      /native\.routes\["\/feed"\]\.screen must be "web", "native", or "platform"/,
    );
    expect(() => routes({ "/feed": { screen: "native", android: "FeedScreen" } })).toThrow(
      /native\.routes\["\/feed"\]\.android must be "web", "native", or "platform"/,
    );
    expect(routes({ "/feed": { screen: "native", ios: "web", android: "platform" } })).toBeTruthy();
    const native = (value: unknown) => validateFarmMobileConfig({ native: value } as never);
    expect(() => native("on")).toThrow(/native must be an object/);
    expect(() => native({ engine: "flutter" })).toThrow(
      /native\.engine must be "react-native" or "platform"/,
    );
    expect(() => native({ auto: true })).toThrow(/native\.auto must be "off", "report", or "on"/);
    expect(() => native({ prefetch: false })).toThrow(/native\.prefetch must be "intent" or "off"/);
    expect(() => native({ islands: "Map" })).toThrow(/native\.islands must be an array/);
    expect(() => native({ islands: ["src/map.tsx"] })).toThrow(/component names/);
    expect(() => native({ budgets: { screenOpenMs: -1 } })).toThrow(
      /native\.budgets\.screenOpenMs must be a number of 0 or more/,
    );
    expect(() => native({ budgets: { fps: 60 } })).toThrow(/unknown option native\.budgets\.fps/);
    // Device plugins will be mobile.modules, never mobile.native.
    expect(() => native({ modules: {} })).toThrow(
      /unknown option native\.modules\. Supported: engine, auto, routes, islands, prefetch, budgets/,
    );
    // One presentation per route, even when a group spells the key differently.
    expect(() =>
      validateFarmMobileConfig({
        routes: { "/(account)/settings": { presentation: "modal" } },
        native: { routes: { "/settings": { screen: "web", presentation: "push" } } },
      }),
    ).toThrow(
      /routes\["\/\(account\)\/settings"\]\.presentation and native\.routes\["\/settings"\]\.presentation set the same field/,
    );
  });

  it("explains where a route's native module name went", () => {
    // #2420's form, never released: routes[x].native named a src/native/ module.
    expect(() =>
      validateFarmMobileConfig({ routes: { "/feed": { native: "feed" } } } as never),
    ).toThrow(
      /^mobile: routes\["\/feed"\]\.native no longer names a src\/native\/ module \(src\/native\/ is for native module specs\)\. Add src\/app\/feed\/page\.native\.tsx next to its page\.tsx, or set native: \{ routes: \{ "\/feed": \{ screen: "native" \} \} \}\./,
    );
    expect(() =>
      validateFarmMobileConfig({ native: { routes: { "/feed": { native: "feed" } } } } as never),
    ).toThrow(/native\.routes\["\/feed"\]\.native no longer names a src\/native\/ module/);
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

  it("checks tabs and routes against the app's routes", async () => {
    const root = await createApp();
    const resolve = (input: Parameters<typeof resolveFarmMobileConfig>[0]) =>
      resolveFarmMobileConfig(input, { root, routes: ROUTES }, build);

    expect(resolve({ server: "https://notes.example.com/" })).toEqual({
      name: "notes-app",
      id: "local.farm.notesapp",
      server: "https://notes.example.com",
      tabs: [],
      routes: {},
      native: NATIVE,
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
      resolve({ native: { routes: { "/notes/[noteId]": { screen: "native" } } } }),
    ).toThrow(
      /native\.routes\["\/notes\/\[noteId\]"\] is not a page route; did you mean "\/notes\/\[id\]"\?/,
    );
    const tabs = [{ path: "/notes", title: "Notes", icon: "notes" }];
    expect(() => resolve({ tabs, routes: { "/notes": { presentation: "modal" } } })).toThrow(
      /routes\["\/notes"\]\.presentation does not apply to a tab route/,
    );
    expect(() =>
      resolve({ tabs, native: { routes: { "/notes": { screen: "web", presentation: "modal" } } } }),
    ).toThrow(/native\.routes\["\/notes"\]\.presentation does not apply to a tab route/);
    // A group in the key is the same URL pattern.
    expect(
      resolve({ routes: { "/(account)/settings": { presentation: "modal" } } }).routes,
    ).toEqual({ "/settings": { presentation: "modal" } });
    expect(
      resolve({
        native: {
          engine: "platform",
          auto: "off",
          routes: { "/(account)/settings": { screen: "native", ios: "web" } },
          islands: ["Video", "Map", "Map"],
          prefetch: "off",
          budgets: { screenOpenMs: 300 },
        },
      }).native,
    ).toEqual({
      engine: "platform",
      auto: "off",
      routes: { "/settings": { screen: "native", ios: "web" } },
      islands: ["Map", "Video"],
      prefetch: "off",
      budgets: { screenOpenMs: 300 },
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
    const root = await createApp({ "src/app/feed/page.native.tsx": PAGE });
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
          routes: { "/notes/new": { presentation: "modal" } },
          native: { routes: { "/notes/[id]/edit": { screen: "web", presentation: "replace" } } },
        },
      },
    });
    expect(await fs.realpath(result.file)).toBe(
      path.join(await fs.realpath(root), ".farm", "output", "mobile", "farm-routes.json"),
    );
    const manifest = JSON.parse(await fs.readFile(result.file, "utf8"));
    const web = { screen: "web", source: "default" };
    expect(manifest).toEqual({
      version: 1,
      server: "https://notes.example.com",
      tabs: [
        { path: "/notes", title: "Notes", icon: "note.text" },
        { path: "/settings", title: "Settings", icon: "gear" },
      ],
      prefetch: "intent",
      // Most specific first, as the client router orders routes.
      rules: [
        { route: "/notes/new", pattern: "^/notes/new/?$", presentation: "modal", ...web },
        {
          route: "/notes/[id]/edit",
          pattern: "^/notes/[^/]+/edit/?$",
          presentation: "replace",
          screen: "web",
          source: "config",
        },
        { route: "/notes/[id]", pattern: "^/notes/[^/]+/?$", presentation: "push", ...web },
        {
          route: "/feed",
          pattern: "^/feed/?$",
          presentation: "push",
          screen: "native",
          source: "file",
          module: "app/feed",
        },
        { route: "/notes", pattern: "^/notes/?$", presentation: "tab", tab: 0, ...web },
        { route: "/settings", pattern: "^/settings/?$", presentation: "tab", tab: 1, ...web },
        {
          route: "/docs/[...slug]",
          pattern: "^/docs(?:/[^/]+)+/?$",
          presentation: "push",
          ...web,
        },
        {
          route: "/shop/[[...filters]]",
          pattern: "^/shop(?:/[^/]+)*/?$",
          presentation: "push",
          ...web,
        },
        { route: "/", pattern: "^/?$", presentation: "push", ...web },
        { pattern: "^/", presentation: "push", screen: "web" },
      ],
    });
    // The slot page and the route group add no rule.
    expect(JSON.stringify(manifest)).not.toMatch(/@sidebar|\(account\)/);
  });

  it("picks the same route as the client router for every path", () => {
    const manifest = createFarmMobileRouteManifest(
      { name: "n", id: "a.b", server: "https://x.dev", tabs: [], routes: {}, native: NATIVE },
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
      { name: "n", id: "a.b", server: "https://x.dev", tabs: [], routes: {}, native: NATIVE },
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
        native: NATIVE,
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

describe("mobile screens", () => {
  const userConfig = (native: object = {}, extra: object = {}): FarmUserConfig => ({
    telemetry: false,
    mobile: { id: "com.example.notes", server: "https://notes.example.com", native, ...extra },
  });
  const appFor = async (
    root: string,
    config: FarmUserConfig,
    os: "android" | "ios" = "android",
  ) => {
    const { resolveFarmMobileApp } = await loadFarmMobileRuntime();
    return resolveFarmMobileApp({ root, os, userConfig: config });
  };
  const screensOf = async (...args: Parameters<typeof appFor>) => (await appFor(...args)).screens;
  const base = { presentation: "push", prefetch: "intent" } as const;

  it("picks a screen per route and OS: page export, config, files, then web", async () => {
    const root = await createApp({
      // A native file the page turns off, with config asking for native too.
      "src/app/notes/[id]/page.native.tsx": PAGE,
      "src/app/notes/[id]/page.tsx": `export const mobile = { native: false, presentation: "modal" } as const;\n${PAGE}`,
      // A native file plus an iOS one; config keeps Android web while it is in progress.
      "src/app/feed/page.native.tsx": PAGE,
      "src/app/feed/page.ios.tsx": PAGE,
      // Only an Android file: iOS stays web.
      "src/app/(account)/settings/page.android.tsx": PAGE,
      // Platform screens by file location.
      "src/app/docs/[...slug]/page.kt": "",
      "src/app/docs/[...slug]/page.swift": "",
    });
    const config = userConfig({
      routes: {
        "/feed": { screen: "native", android: "web" },
        "/notes/[id]": { screen: "native" },
        "/notes/new": { screen: "web", presentation: "modal" },
        "/shop/[[...filters]]": { screen: "web", ios: "native" },
      },
    });
    const android = await appFor(root, config);
    expect(android.screens["/notes/[id]"]).toEqual({
      screen: "web",
      source: "page",
      file: "src/app/notes/[id]/page.tsx",
      presentation: "modal",
      prefetch: "intent",
    });
    expect(android.screens["/feed"]).toEqual({ screen: "web", source: "config", ...base });
    expect(android.screens["/settings"]).toEqual({
      screen: "native",
      source: "file",
      file: "src/app/(account)/settings/page.android.tsx",
      module: "app/settings",
      ...base,
    });
    expect(android.screens["/docs/[...slug]"]).toEqual({
      screen: "platform",
      source: "file",
      file: "src/app/docs/[...slug]/page.kt",
      module: "app/docs/[...slug]",
      ...base,
    });
    expect(android.screens["/notes/new"]).toEqual({
      screen: "web",
      source: "config",
      presentation: "modal",
      prefetch: "intent",
    });
    expect(android.screens["/shop/[[...filters]]"]).toMatchObject({
      screen: "web",
      source: "config",
    });
    expect(android.screens["/"]).toEqual({ screen: "web", source: "default", ...base });
    // The page export wins over config and the native file, and says so.
    expect(android.warnings).toEqual([
      'src/app/notes/[id]/page.tsx: mobile.native false overrides native.routes["/notes/[id]"].screen "native"; the route stays web.',
      "src/app/notes/[id]/page.native.tsx is unused: src/app/notes/[id]/page.tsx sets mobile.native to false.",
    ]);

    const ios = await appFor(root, config, "ios");
    expect(ios.screens["/feed"]).toEqual({
      screen: "native",
      source: "config",
      file: "src/app/feed/page.ios.tsx",
      module: "app/feed",
      ...base,
    });
    expect(ios.screens["/settings"]).toEqual({ screen: "web", source: "default", ...base });
    expect(ios.screens["/docs/[...slug]"]).toMatchObject({
      screen: "platform",
      file: "src/app/docs/[...slug]/page.swift",
    });
    // Config asks for a port nothing can build yet: the route stays web, with a warning.
    expect(ios.screens["/shop/[[...filters]]"]).toEqual({
      screen: "web",
      source: "config",
      requested: "native",
      ...base,
    });
    expect(ios.warnings).toEqual([
      ...android.warnings,
      'native.routes["/shop/[[...filters]]"].ios is "native", but "/shop/[[...filters]]" has no page.native.tsx and Farm cannot port pages yet, so it stays web. This fails the build once native screens ship.',
    ]);

    const manifest = android.manifest.rules;
    expect(manifest.find((rule) => rule.route === "/docs/[...slug]")).toMatchObject({
      screen: "platform",
      source: "file",
      module: "app/docs/[...slug]",
    });
    expect(manifest.find((rule) => rule.route === "/feed")).toEqual({
      route: "/feed",
      pattern: "^/feed/?$",
      presentation: "push",
      screen: "web",
      source: "config",
    });
  });

  it("checks platform screens and the engine", async () => {
    const root = await createApp({
      "src/app/feed/page.native.tsx": PAGE,
      "src/app/feed/page.kt": "",
    });
    await expect(screensOf(root, userConfig())).rejects.toThrow(
      /mobile \(os: android\): "\/feed" has two screens on android: src\/app\/feed\/page\.native\.tsx and src\/app\/feed\/page\.kt\. Keep one\./,
    );
    // iOS has only the React Native file.
    expect((await screensOf(root, userConfig(), "ios"))["/feed"]).toMatchObject({
      screen: "native",
      source: "file",
    });
    await expect(screensOf(root, userConfig({ engine: "platform" }), "ios")).rejects.toThrow(
      /src\/app\/feed\/page\.native\.tsx is a React Native screen, but native\.engine is "platform"/,
    );
    await expect(
      screensOf(root, userConfig({ routes: { "/notes": { screen: "platform" } } }), "ios"),
    ).rejects.toThrow(
      /native\.routes\["\/notes"\]\.screen is "platform", which needs page\.swift next to the route's page\.tsx/,
    );

    const platformApp = await createApp({ "src/app/feed/page.swift": "" });
    const platform = userConfig({
      engine: "platform",
      routes: { "/feed": { screen: "native" }, "/notes": { screen: "native" } },
    });
    const ios = await appFor(platformApp, platform, "ios");
    expect(ios.screens["/feed"]).toMatchObject({ screen: "platform", source: "config" });
    expect(ios.screens["/notes"]).toMatchObject({ screen: "web", requested: "platform" });
    expect(ios.warnings[0]).toMatch(/has no page\.swift and Farm cannot port pages yet/);
  });

  it("reads a page's mobile export without running it", async () => {
    const root = await createApp({
      "src/app/notes/new/page.tsx": `import type { FarmMobilePageConfig } from "@farm.js/core/config";
throw new Error("never runs");
export const mobile = { presentation: "modal", prefetch: "off" } satisfies FarmMobilePageConfig;
${PAGE}`,
      // "mobile" in a string is not an export.
      "src/app/notes/page.tsx": `const label = "mobile";\n${PAGE}`,
      // A .js page with JSX.
      "src/app/about/page.js": `export const mobile = { prefetch: "off" };\nexport default function Feed() { return <p>feed</p>; }\n`,
    });
    const { resolveFarmMobileApp } = await loadFarmMobileRuntime();
    const app = await resolveFarmMobileApp({ root, userConfig: userConfig() });
    expect(app.screens["/notes/new"]).toEqual({
      screen: "web",
      source: "default",
      presentation: "modal",
      prefetch: "off",
    });
    expect(app.manifest.rules.find((rule) => rule.route === "/notes/new")).toMatchObject({
      presentation: "modal",
      prefetch: "off",
    });
    expect(app.screens["/about"]).toMatchObject({ prefetch: "off" });
    expect(app.warnings).toEqual([]);
    // A page presentation over a config one warns with both.
    const overridden = await resolveFarmMobileApp({
      root,
      userConfig: userConfig({}, { routes: { "/notes/new": { presentation: "replace" } } }),
    });
    expect(overridden.warnings).toEqual([
      'src/app/notes/new/page.tsx: mobile.presentation "modal" overrides the config\'s "replace" for "/notes/new".',
    ]);
    expect(app.manifest.rules.find((rule) => rule.route === "/notes")).not.toHaveProperty(
      "prefetch",
    );

    for (const [source, message] of [
      [`export const mobile = { presentation: getPresentation() };`, /must use literal values/],
      [`export let mobile = { native: false };`, /must be a const/],
      [`const mobile = {}; export { mobile };`, /must be declared in place/],
      [`export const mobile = { ...base };`, /without spreads/],
      [`export const mobile = { native: true };`, /mobile\.native can only be false/],
      [
        `export const mobile = { tab: 1 };`,
        /unknown option src\/app\/notes\/page\.tsx: mobile\.tab/,
      ],
      [`export const mobile = { presentation: "sheet" };`, /mobile\.presentation must be "push"/],
    ] as const) {
      await fs.writeFile(path.join(root, "src/app/notes/page.tsx"), `${source}\n${PAGE}`);
      await expect(
        resolveFarmMobileApp({ root, userConfig: userConfig() }),
        source,
      ).rejects.toThrow(message);
    }
    await fs.writeFile(
      path.join(root, "src/app/notes/page.tsx"),
      `export const mobile = { presentation: "modal" };\n${PAGE}`,
    );
    await expect(
      resolveFarmMobileApp({
        root,
        userConfig: userConfig({}, { tabs: [{ path: "/notes", title: "Notes", icon: "notes" }] }),
      }),
    ).rejects.toThrow(/src\/app\/notes\/page\.tsx: mobile\.presentation does not apply to a tab/);
  });

  it("needs a web page next to every native page and one file per platform", async () => {
    const lonely = await createApp({ "src/app/inbox/page.native.tsx": PAGE });
    await expect(screensOf(lonely, userConfig())).rejects.toThrow(
      /src\/app\/inbox\/page\.native\.tsx has no web page next to it\. Add src\/app\/inbox\/page\.tsx/,
    );
    const swift = await createApp({ "src/app/inbox/page.swift": "" });
    await expect(screensOf(swift, userConfig())).rejects.toThrow(
      /src\/app\/inbox\/page\.swift has no web page next to it/,
    );
    const twice = await createApp({
      "src/app/feed/page.native.tsx": PAGE,
      "src/app/feed/page.native.jsx": PAGE,
    });
    await expect(screensOf(twice, userConfig())).rejects.toThrow(
      /Duplicate native page for "\/feed"/,
    );
  });

  it("lists reserved native layouts and leaves the web route scan alone", async () => {
    const root = await createApp({
      "src/app/feed/page.native.tsx": PAGE,
      "src/app/notes/layout.tsx": PAGE,
      "src/app/notes/layout.native.tsx": PAGE,
      "src/app/(account)/layout.ios.tsx": PAGE,
      "src/app/layout.native.tsx": PAGE,
    });
    const { resolveFarmMobileApp } = await loadFarmMobileRuntime();
    const app = await resolveFarmMobileApp({ root, userConfig: userConfig() });
    expect(app.nativeLayouts).toEqual({
      "/": { native: "src/app/layout.native.tsx" },
      "/(account)": { ios: "src/app/(account)/layout.ios.tsx" },
      "/notes": { native: "src/app/notes/layout.native.tsx" },
    });
    const web = await scanRoutePatterns({ root });
    expect(Object.keys(web).sort()).toEqual(["modules", "pages"]);
    expect([...web.pages].sort()).toEqual([...ROUTES].sort());
    // Generated route types don't change with mobile files present.
    const plain = await createApp();
    const outPath = path.join(root, "src", "farm-routes.d.ts");
    expect(await createRouteTypeDeclarations({ root }, outPath)).toBe(
      await createRouteTypeDeclarations({ root: plain }, outPath),
    );
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
