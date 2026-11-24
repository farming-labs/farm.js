import { describe, expect, it, vi } from "vitest";
import { generateClientHydrationEntry, splitFarmClientEntry } from "../nitro/universal-build";

const generate = (islandValues: boolean, serverStylesheets: string[] = []) =>
  generateClientHydrationEntry(
    [],
    [],
    [],
    "/app",
    "src",
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    undefined,
    undefined,
    false,
    [],
    "/",
    undefined,
    undefined,
    islandValues,
    undefined,
    serverStylesheets,
  );

describe("the islands-mode client entry", () => {
  it.each([true, false])(
    "defines every helper it calls, for an app with server pages only (islands: %s)",
    (islandValues) => {
      const entry = generate(islandValues);
      // An islands app without client components still waits for the document before the docs
      // runtime hydrates.
      if (entry.includes("farmDocumentParsed()")) {
        expect(entry).toContain("function farmDocumentParsed()");
      }
      expect(entry.includes("farmDocumentParsed()")).toBe(islandValues);
    },
  );

  it("imports the stylesheets server modules import, keeping each CSS module's class map", () => {
    const entry = generate(true, ["/app/src/app/page.css", "/app/src/card.module.css"]);
    expect(entry).toContain('import "/app/src/app/page.css";');
    // Left unused, a CSS module's class map would be tree-shaken with its stylesheet.
    expect(entry).toContain('import * as __farmServerStyle0 from "/app/src/card.module.css";');
    expect(entry).toContain("globalThis.__FARM_SERVER_STYLES__ = [__farmServerStyle0];");
    expect(generate(true)).not.toContain("__farmServerStyle");
  });
});

describe("client plugin hydration hooks", () => {
  it("run around a page whose only client code is its islands", () => {
    const boundary = { modulePath: "/app/src/counter.tsx", islandStrategy: "load" as const };
    const entry = generateClientHydrationEntry(
      [
        {
          pattern: "/",
          modulePath: "/app/src/app/page.tsx",
          relativePath: "page.tsx",
          pageShouldHydrate: false,
          islandStrategy: "load",
          hasIsolatedClientBoundaries: true,
          isolatedBoundaries: [boundary],
        },
      ],
      [],
      [],
      "/app",
      "src",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      false,
      [],
      "/",
      undefined,
      undefined,
      true,
    );
    const start = entry.indexOf(
      "matched.route.hasIsolatedClientBoundaries &&\n    !matched.route.pageShouldHydrate",
    );
    expect(start).toBeGreaterThan(-1);
    const branch = entry.slice(start, entry.indexOf("return;", start));
    const begin = branch.indexOf("farmClientRuntime.beginHydration(");
    const islands = branch.indexOf("hydrateFarmIsolatedClientBoundaries(document)");
    const complete = branch.indexOf("farmClientRuntime.completeHydration(");
    expect(begin).toBeGreaterThan(-1);
    expect(islands).toBeGreaterThan(begin);
    expect(complete).toBeGreaterThan(islands);
  });
});

describe("splitFarmClientEntry", () => {
  const source = [
    'import { eagerOnly, both, routerOnly, spreadOnly } from "pkg";',
    "const shared = 1;",
    "const unrelated = 2;",
    "eagerOnly(both, unrelated);",
    "/*farm-router-start*/",
    "const spaRouter = { go() { return [shared, both(), routerOnly(), obj.unrelated, { ...spreadOnly() }]; } };",
    "/*farm-router-end*/",
    "/*farm-router-stub*/",
  ].join("\n");

  it("moves the marked code and leaves the stand-in router in the entry", () => {
    const { entry, router } = splitFarmClientEntry(source);
    expect(router).toContain("const spaRouter = { go()");
    expect(router).toContain("export { spaRouter };");
    expect(entry).not.toContain("go()");
    expect(entry).not.toContain("farm-router-stub");
    expect(entry).toContain("function loadFarmRouter()");
  });

  it("imports only what the router uses, through the entry when the entry uses it too", () => {
    const { entry, router } = splitFarmClientEntry(source);
    expect(entry).toContain("export { both, shared };");
    expect(router).toContain('import { both, shared } from "./farm-client-entry";');
    expect(router).toContain('import { routerOnly } from "pkg";');
    // A spread is the binding, a property after one dot is not.
    expect(router).toContain('import { spreadOnly } from "pkg";');
    expect(router).not.toMatch(/import \{[^}]*\bunrelated\b/);
  });

  it("leaves the markers inert in an entry that is not split", () => {
    const code = generate(false);
    expect(code).not.toContain("function loadFarmRouter()");
    expect(code).toContain("const spaRouter = {");
  });
});

const clientPage = {
  pattern: "/",
  modulePath: "/app/src/app/page.tsx",
  relativePath: "page.tsx",
  pageShouldHydrate: true,
  islandStrategy: "load" as const,
  hasIsolatedClientBoundaries: false,
  isolatedBoundaries: [],
};

describe("Link prefetch without hydration", () => {
  const install = "installFarmLinkPrefetch();";

  it("is installed by the entry of an app without client components", () => {
    const entry = generate(false);
    expect(entry).toContain("Client Runtime (no client components)");
    expect(entry).toContain(install);
    expect(entry).toMatch(
      /import \{[^}]*\binstallFarmLinkPrefetch\b[^}]*\} from "@farm.js\/core\/internal\/client-runtime"/,
    );
  });

  it.each([false, true])(
    "is installed with the router by the entry of an app with client pages (islands: %s)",
    (islandValues) => {
      const code = generateClientHydrationEntry(
        [clientPage],
        [],
        [],
        "/app",
        "src",
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        false,
        [],
        "/",
        undefined,
        undefined,
        islandValues,
      );
      expect(code.indexOf(install)).toBeGreaterThan(
        code.indexOf("window.__FARM_SPA_ROUTER__ = spaRouter;"),
      );
      if (!islandValues) return;
      // Islands mode loads the router when a navigation first needs it, and Link prefetch with it.
      const { entry, router } = splitFarmClientEntry(code);
      expect(entry).not.toContain(install);
      expect(router).toContain(install);
      expect(router).toMatch(
        /import \{ installFarmLinkPrefetch \} from "@farm.js\/core\/internal\/client-runtime";/,
      );
    },
  );
});

describe("Link navigation options without hydration", () => {
  const navigate = "spaRouter.navigate(href, readFarmLinkNavigateOptions(anchor));";
  const imported =
    /import \{[^}]*\breadFarmLinkNavigateOptions\b[^}]*\} from "@farm.js\/core\/internal\/client-runtime"/;

  it("are read by the click handler of an app without client components", () => {
    const entry = generate(false);
    expect(entry).toContain("Client Runtime (no client components)");
    expect(entry).toContain(navigate);
    expect(entry).toMatch(imported);
  });

  it.each([false, true])(
    "are read by the click handler of an app with client pages (islands: %s)",
    (islandValues) => {
      const code = generateClientHydrationEntry(
        [clientPage],
        [],
        [],
        "/app",
        "src",
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        false,
        [],
        "/",
        undefined,
        undefined,
        islandValues,
      );
      expect(code).toContain(navigate);
      expect(code).not.toContain("spaRouter.navigate(href);");
      if (!islandValues) return;
      // Islands mode keeps the click handler in the entry, in front of the lazily loaded router.
      const { entry, router } = splitFarmClientEntry(code);
      expect(entry).toContain(navigate);
      expect(entry).toMatch(imported);
      expect(router).not.toContain(navigate);
    },
  );
});

describe("the islands web entry's renderer (RFC 0010)", () => {
  const islandPage = {
    pattern: "/",
    modulePath: "/app/src/app/page.tsx",
    relativePath: "page.tsx",
    pageShouldHydrate: false,
    islandStrategy: "load" as const,
    hasIsolatedClientBoundaries: true,
    isolatedBoundaries: [{ modulePath: "/app/src/counter.tsx", islandStrategy: "load" as const }],
  };
  const slot = {
    name: "modal",
    ownerPattern: "/",
    pattern: "/photo/[id]",
    modulePath: "/app/src/app/@modal/photo/[id]/page.tsx",
    containerId: "farm-slot-modal",
    interception: true,
    fallback: false,
  };
  const generateFor = (options: { platform?: "mobile"; slots?: (typeof slot)[] } = {}) =>
    generateClientHydrationEntry(
      [islandPage],
      [],
      options.slots ?? [],
      "/app",
      "src",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      false,
      [],
      "/",
      undefined,
      undefined,
      true,
      options.platform,
    );
  const staticRenderer =
    /^import [^;]*from "(?:react|react-dom\/client|@farm\.js\/core\/internal\/islands-runtime)";/m;

  it("imports React, React DOM and islx when it first renders or hydrates, so its router runs without them", () => {
    const { entry, router } = splitFarmClientEntry(generateFor());
    expect(entry).not.toMatch(staticRenderer);
    expect(router).not.toMatch(staticRenderer);
    expect(entry).toContain('import("react")');
    expect(entry).toContain('import("react-dom/client")');
    expect(entry).toContain('import("@farm.js/core/internal/islands-runtime")');
    // A swap that streams in before they load hydrates its islands once they have.
    expect(router).toMatch(
      /import \{[^}]*\bfarmRendererLoaded\b[^}]*\} from "\.\/farm-client-entry";/,
    );
  });

  it("loads React DOM and islx with the first island that is due, not with every hydration", () => {
    const entry = generateFor();
    expect(entry).toMatch(
      /import \{[^}]*\bwatchFarmIslandTriggers\b[^}]*\} from "@farm\.js\/core\/internal\/client-runtime";/,
    );
    expect(entry).toContain('watchFarmIslandTriggers(scope, "f-island"');
    // Whatever loads them, what waited for them runs with them, in order.
    expect(entry).toMatch(/releaseFarmIslandInteractions\(\);\s*runFarmIslandsWaiting\(\);/);
  });

  // A module object that escapes (passed whole to a function) keeps every export of islx's
  // runtime in the bundle, 11 KB more than the static import kept.
  it("names the islx exports it uses where it imports them, so the build drops the rest", () => {
    expect(generateFor()).toMatch(
      /import\("@farm\.js\/core\/internal\/islands-runtime"\)\.then\(function\(\{ createFarmIsolatedHydrationRuntime, createFarmServerPageBoundary, wrapFarmIsolatedClientGraph \}\)/,
    );
  });

  it("keeps React and React DOM in the entry of the mobile client and of an app with client route slots", () => {
    expect(generateFor({ platform: "mobile" })).toMatch(staticRenderer);
    expect(generateFor({ slots: [slot] })).toMatch(staticRenderer);
  });
});

describe("the islands web entry's root code (RFC 0013)", () => {
  const hydratingLayout = {
    pattern: "/",
    modulePath: "/app/src/app/layout.tsx",
    shouldHydrate: true,
    islandStrategy: "load" as const,
    hasIsolatedClientBoundaries: false,
    isolatedBoundaries: [],
  };
  const generateFor = (platform?: "mobile", islandValues = true) =>
    generateClientHydrationEntry(
      [clientPage],
      [hydratingLayout],
      [],
      "/app",
      "src",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      false,
      [],
      "/",
      undefined,
      undefined,
      islandValues,
      platform,
    );
  const islandLayout = {
    ...hydratingLayout,
    shouldHydrate: false,
    islandStrategy: null,
    hasIsolatedClientBoundaries: true,
    isolatedBoundaries: [{ modulePath: "/app/src/counter.tsx", islandStrategy: "load" as const }],
  };
  const islandPage = {
    ...clientPage,
    pageShouldHydrate: false,
    hasIsolatedClientBoundaries: true,
    isolatedBoundaries: islandLayout.isolatedBoundaries,
  };
  const treePage = {
    ...clientPage,
    pattern: "/tree",
    modulePath: "/app/src/app/tree/page.tsx",
    relativePath: "tree/page.tsx",
    pageShouldHydrate: false,
    serverTree: true as const,
  };
  const slot = {
    name: "modal",
    ownerPattern: "/",
    pattern: "/photo/[id]",
    modulePath: "/app/src/app/@modal/photo/[id]/page.tsx",
    containerId: "farm-slot-modal",
    interception: true,
    fallback: false,
  };
  const generateWith = (options: {
    pages?: (typeof clientPage | typeof islandPage | typeof treePage)[];
    layouts?: (typeof hydratingLayout | typeof islandLayout)[];
    slots?: (typeof slot)[];
    i18n?: boolean;
  }) =>
    generateClientHydrationEntry(
      options.pages ?? [],
      options.layouts ?? [],
      options.slots ?? [],
      "/app",
      "src",
      false,
      undefined,
      undefined,
      undefined,
      options.i18n
        ? {
            enabled: true,
            basePath: "/",
            locales: ["en", "fr"],
            defaultLocale: "en",
            messages: "",
            routing: "prefix-except-default",
            detection: [],
            fallbackLocale: "en",
            strict: false,
            cookie: { name: "farm_locale", maxAge: 0, path: "/", sameSite: "lax", secure: false },
            direction: {},
          }
        : undefined,
      [],
      undefined,
      undefined,
      false,
      [],
      "/",
      undefined,
      undefined,
      true,
    );
  const exported = (code: string) =>
    (/^export \{ ([^}]*) \};$/m.exec(code)?.[1] ?? "").split(", ").filter(Boolean);
  const importedFrom = (code: string, file: string) =>
    [...code.matchAll(new RegExp(`^import \\{ ([^}]*) \\} from "${file}";$`, "gm"))].flatMap(
      (match) => match[1]!.split(", "),
    );

  it("moves what renders a page or layout root, with the layouts it renders, out of the entry", () => {
    const { entry, router, root } = splitFarmClientEntry(generateFor());
    expect(root).toBeDefined();
    for (const name of ["createMatchedHydrationRoute", "hydrateFarmRoute", "renderFarmRoute"]) {
      expect(root).toContain(`function ${name}(`);
      expect(entry).not.toContain(`function ${name}(`);
    }
    expect(root).toContain('import Layout0 from "/app/src/app/layout.tsx";');
    expect(entry).not.toContain("/app/src/app/layout.tsx");
    expect(entry).toContain('{ pattern: "/", Component: null,');
    // The entry and the router load it when a root hydrates or a navigation renders one.
    expect(entry).toContain('import("./farm-client-root")');
    expect(entry).not.toMatch(/^import [^;]*"\.\/farm-client-root";/m);
    expect(router).not.toContain("./farm-client-root");
  });

  it("links the entry, the router and the root module by the names each one uses", () => {
    const { entry, router, root } = splitFarmClientEntry(generateFor());
    const fromEntry = exported(entry);
    expect(fromEntry.length).toBeGreaterThan(0);
    for (const name of [
      ...importedFrom(router, "./farm-client-entry"),
      ...importedFrom(root!, "./farm-client-entry"),
    ]) {
      expect(fromEntry).toContain(name);
    }
    // Whatever the entry and the router call on the module they load, it exports.
    const called = new Set(
      [...`${entry}\n${router}`.matchAll(/\bfarmRoot\.([\w$]+)/g)].map((match) => match[1]!),
    );
    expect(called.size).toBeGreaterThan(0);
    for (const name of called) expect(exported(root!)).toContain(name);
  });

  it("refuses router and root code that use each other's, which would load them together", () => {
    const source = (routerCode: string, rootCode: string) =>
      [
        "/*farm-router-start*/",
        "function routerOnly() {}",
        `const spaRouter = { go() { ${routerCode} } };`,
        "/*farm-router-end*/",
        "/*farm-router-stub*/",
        "/*farm-root-start*/",
        `function createFarmRouteState() { ${rootCode} }`,
        "/*farm-root-end*/",
        "/*farm-root-stub-start*/",
        "function loadFarmRoot() {}",
        "/*farm-root-stub-end*/",
      ].join("\n");
    expect(() => splitFarmClientEntry(source("", "return routerOnly();"))).toThrow(
      /use routerOnly from each other/,
    );
    expect(() => splitFarmClientEntry(source("return createFarmRouteState();", ""))).toThrow(
      /use createFarmRouteState from each other/,
    );
    // The router calls the root module's code on the module it loads.
    expect(() =>
      splitFarmClientEntry(source("return farmRoot.createFarmRouteState();", "")),
    ).not.toThrow();
  });

  it.each([
    ["a client page", { pages: [clientPage] }],
    ["a hydrating layout", { pages: [islandPage], layouts: [hydratingLayout] }],
    ["a layout with islands", { pages: [islandPage], layouts: [islandLayout] }],
    [
      "a server-tree page below a hydrating layout",
      { pages: [treePage], layouts: [hydratingLayout] },
    ],
    ["client route slots", { pages: [clientPage], slots: [slot] }],
    ["i18n routing", { pages: [clientPage], layouts: [hydratingLayout], i18n: true }],
  ])("splits the entry of an app with %s", (_, options) => {
    const { entry, router, root } = splitFarmClientEntry(generateWith(options));
    expect(root).toBeDefined();
    expect(router).not.toContain("./farm-client-root");
    for (const name of exported(root!)) {
      expect(root).toMatch(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
      expect(entry).not.toMatch(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    }
  });

  it("loads the root module once, and again after a load that failed", async () => {
    const { entry } = splitFarmClientEntry(generateFor());
    const stub = /let farmRootLoading = null;\nfunction loadFarmRoot\(\) \{[\s\S]*?\n\}\n/.exec(
      entry,
    )?.[0];
    expect(stub).toBeDefined();
    const module = { createFarmRouteState() {} };
    const load = vi
      .fn<() => Promise<typeof module>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(module);
    const loadFarmRoot = new Function(
      "__load",
      `${stub!.replace('import("./farm-client-root")', "__load()")}\nreturn loadFarmRoot;`,
    )(load) as () => Promise<typeof module>;
    await expect(loadFarmRoot()).rejects.toThrow("offline");
    const [first, second] = [loadFarmRoot(), loadFarmRoot()];
    expect(first).toBe(second);
    await expect(first).resolves.toBe(module);
    await expect(loadFarmRoot()).resolves.toBe(module);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an islands entry before it is split", generateFor()],
    ["the mobile client's entry", generateFor("mobile")],
    ["an entry outside islands mode", generateFor(undefined, false)],
  ])("keeps the root code in %s, behind a stand-in that returns it", (_, code) => {
    const names = /function loadFarmRoot\(\) \{\n {2}return Promise\.resolve\(\{ ([^}]*) \}\);/
      .exec(code)?.[1]
      ?.split(", ");
    expect(names?.length).toBeGreaterThan(0);
    for (const name of names!) {
      expect(code).toMatch(new RegExp(`^(?:async )?function ${name}\\(|^const ${name} =`, "m"));
    }
    expect(code).not.toContain('import("./farm-client-root")');
  });

  it("registers client layouts in the entry of the mobile client and outside islands mode", () => {
    for (const code of [generateFor("mobile"), generateFor(undefined, false)]) {
      expect(code).toMatch(/^import Layout0 from "\/app\/src\/app\/layout\.tsx";$/m);
      expect(code).toContain("Component: Layout0,");
    }
  });
});
