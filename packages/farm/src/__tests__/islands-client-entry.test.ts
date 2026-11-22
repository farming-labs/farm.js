import { describe, expect, it } from "vitest";
import { generateClientHydrationEntry, splitFarmClientRouter } from "../nitro/universal-build";

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

describe("splitFarmClientRouter", () => {
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
    const { entry, router } = splitFarmClientRouter(source);
    expect(router).toContain("const spaRouter = { go()");
    expect(router).toContain("export { spaRouter };");
    expect(entry).not.toContain("go()");
    expect(entry).not.toContain("farm-router-stub");
    expect(entry).toContain("function loadFarmRouter()");
  });

  it("imports only what the router uses, through the entry when the entry uses it too", () => {
    const { entry, router } = splitFarmClientRouter(source);
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
      const { entry, router } = splitFarmClientRouter(code);
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
      const { entry, router } = splitFarmClientRouter(code);
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
    const { entry, router } = splitFarmClientRouter(generateFor());
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
