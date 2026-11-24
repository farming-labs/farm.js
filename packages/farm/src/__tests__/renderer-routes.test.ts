import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFarmRenderer, type FarmRenderer, type FarmRendererRoutes } from "../renderer";
import { createFarmFolderRoutes, resolveFarmRendererRoutes } from "../routing/renderer-routes";
import { scanRoutePatterns } from "../routing/generate-route-types";
import { RouteManager } from "../routing/route-manager";
import type { FarmConfig } from "../types";

// A renderer's `routes()` decides which files are routes and the URL each serves, and its
// `hydration` which pages and layouts hydrate. These tests run Farm's real route scan and
// hydration reading over files on disk.

const temporaryRoots: string[] = [];
const managers: RouteManager[] = [];

afterEach(async () => {
  managers.splice(0);
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function createRoot(files: Record<string, string>): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-renderer-routes-")));
  temporaryRoots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  return root;
}

const component = "<p>leaf</p>\n";

/** Flat files under src/pages: `index` is its directory, `_layout` its layout, `.client` hydrates. */
const flatRoutes: FarmRenderer["routes"] = () => ({
  dir: "src/pages",
  resolve(file) {
    const url = (segments: readonly string[]) => `/${segments.join("/")}`;
    if (file.name === "_layout") return { kind: "layout", pattern: url(file.segments) };
    if (file.name === "_404") return { kind: "not-found", pattern: "/" };
    if (file.name.startsWith("_")) return null;
    const client = file.name.endsWith(".client");
    const name = file.name.replace(/\.client$/, "");
    return {
      kind: "page",
      pattern: url(name === "index" ? file.segments : [...file.segments, name]),
      ...(client ? { hydrate: true, strategy: "visible" as const } : {}),
    };
  },
});

function leafRenderer(overrides: Partial<FarmRenderer> = {}): FarmRenderer {
  return {
    name: "leaf",
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    componentExtensions: [".leaf"],
    ...overrides,
  };
}

async function discover(root: string, renderer: FarmRenderer): Promise<RouteManager> {
  const manager = new RouteManager({ root, srcDir: "src", renderer } as Required<FarmConfig>);
  managers.push(manager);
  await manager.discoverRoutes();
  return manager;
}

function hydrationOf(manager: RouteManager, root: string, pattern: string) {
  const route = manager
    .generateClientManifest(root)
    .routes.find((entry) => entry.pattern === pattern);
  return { shouldHydrate: route?.shouldHydrate, islandStrategy: route?.islandStrategy };
}

function layoutHydrationOf(manager: RouteManager, root: string, pattern: string) {
  const layout = manager
    .generateClientManifest(root)
    .layouts.find((entry) => entry.pattern === pattern);
  return { shouldHydrate: layout?.shouldHydrate, islandStrategy: layout?.islandStrategy };
}

describe("renderer route rules", () => {
  it("leaves routes to Farm's folders when the renderer has no routes()", async () => {
    const root = await createRoot({ "src/app/page.leaf": component });
    expect(await resolveFarmRendererRoutes({ renderer: leafRenderer(), root })).toBeNull();
  });

  it("maps each file the rules return to a route at the file itself", async () => {
    const root = await createRoot({
      "src/pages/index.leaf": component,
      "src/pages/about.leaf": component,
      "src/pages/blog/[slug].leaf": component,
      "src/pages/blog/_layout.leaf": component,
      "src/pages/watering.client.leaf": component,
      "src/pages/_helpers.leaf": component,
      "src/pages/_404.leaf": component,
    });
    const seen: unknown[] = [];
    const routes = flatRoutes!;
    const table = await resolveFarmRendererRoutes({
      renderer: leafRenderer({
        routes: (context) => {
          const rules = routes(context) as FarmRendererRoutes;
          return {
            ...rules,
            resolve(file) {
              seen.push(file);
              return rules.resolve(file);
            },
          };
        },
      }),
      root,
    });

    expect(table?.dir).toBe(path.join(root, "src/pages"));
    expect(
      table?.entries.map(({ kind, pattern, routeFile, modulePath, hydration }) => ({
        kind,
        pattern,
        routeFile,
        file: path.relative(root, modulePath).split(path.sep).join("/"),
        hydration,
      })),
    ).toEqual([
      {
        kind: "not-found",
        pattern: "/",
        routeFile: "not-found.leaf",
        file: "src/pages/_404.leaf",
        hydration: {},
      },
      {
        kind: "page",
        pattern: "/about",
        routeFile: "about/page.leaf",
        file: "src/pages/about.leaf",
        hydration: {},
      },
      {
        kind: "page",
        pattern: "/blog/[slug]",
        routeFile: "blog/[slug]/page.leaf",
        file: "src/pages/blog/[slug].leaf",
        hydration: {},
      },
      {
        kind: "layout",
        pattern: "/blog",
        routeFile: "blog/layout.leaf",
        file: "src/pages/blog/_layout.leaf",
        hydration: {},
      },
      {
        kind: "page",
        pattern: "/",
        routeFile: "page.leaf",
        file: "src/pages/index.leaf",
        hydration: {},
      },
      {
        kind: "page",
        pattern: "/watering",
        routeFile: "watering/page.leaf",
        file: "src/pages/watering.client.leaf",
        hydration: { hydrate: true, strategy: "visible" },
      },
    ]);
    expect(seen).toContainEqual({
      path: "blog/[slug].leaf",
      segments: ["blog"],
      name: "[slug]",
      extension: ".leaf",
    });
  });

  it("keeps Farm's own files and named slots away from resolve()", async () => {
    const root = await createRoot({
      "src/app/page.leaf": component,
      "src/app/api/crops/route.ts": "export const GET = () => new Response();\n",
      "src/app/middleware.ts": "export default () => {};\n",
      "src/app/sitemap.ts": "export default () => [];\n",
      "src/app/@modal/photo/page.leaf": component,
      "src/app/types.d.ts": "export {};\n",
    });
    const names: string[] = [];
    await resolveFarmRendererRoutes({
      renderer: leafRenderer({
        routes: ({ defaults }) => ({
          resolve(file) {
            names.push(file.path);
            return defaults.resolve(file);
          },
        }),
      }),
      root,
    });
    expect(names).toEqual(["page.leaf"]);
  });

  it("hands Farm's folder rules to routes() as defaults", () => {
    const defaults = createFarmFolderRoutes("src/app");
    const file = (relative: string) => {
      const parts = relative.split("/");
      const fileName = parts.pop()!;
      const extension = path.extname(fileName);
      return {
        path: relative,
        segments: parts,
        name: fileName.slice(0, -extension.length),
        extension,
      };
    };
    expect(defaults.dir).toBe("src/app");
    expect(defaults.resolve(file("page.tsx"))).toEqual({ kind: "page", pattern: "/" });
    expect(defaults.resolve(file("(shop)/cart/layout.tsx"))).toEqual({
      kind: "layout",
      pattern: "/(shop)/cart",
    });
    expect(defaults.resolve(file("docs/[...path]/loading.tsx"))).toEqual({
      kind: "loading",
      pattern: "/docs/[...path]",
    });
    expect(defaults.resolve(file("not-found.tsx"))).toEqual({ kind: "not-found", pattern: "/" });
    expect(defaults.resolve(file("blog/not-found.tsx"))).toBeNull();
    expect(defaults.resolve(file("components/button.tsx"))).toBeNull();
  });

  it.each([
    [{ kind: "screen", pattern: "/" }, 'returned `kind: "screen"`'],
    [{ kind: "page", pattern: "about" }, 'doesn\'t start with "/"'],
    [{ kind: "page", pattern: "/blog//post" }, 'has the segment ""'],
    [{ kind: "page", pattern: "/about/" }, 'has the segment ""'],
    [{ kind: "page", pattern: "/@modal/photo" }, "Named slots (@name) stay in src/app"],
    [{ kind: "page", pattern: "/../secret" }, 'has the segment ".."'],
    [{ kind: "not-found", pattern: "/blog" }, 'return `pattern: "/"`'],
    [{ kind: "page", pattern: "/[...all]/edit" }, "returned `pattern:"],
    [{ kind: "page", pattern: "/", hydrate: "yes" }, "Return true or false"],
    [
      { kind: "page", pattern: "/", strategy: "later" },
      'Return "load", "idle", "visible", or "interaction"',
    ],
    ["page", "Return `{ kind, pattern }`"],
  ])("rejects the rule %j and names the file", async (rule, message) => {
    const root = await createRoot({ "src/app/home.leaf": component });
    const attempt = resolveFarmRendererRoutes({
      renderer: leafRenderer({ routes: () => ({ resolve: () => rule as never }) }),
      root,
    });
    await expect(attempt).rejects.toThrow(message);
    await expect(attempt).rejects.toThrow(path.join(root, "src/app/home.leaf"));
  });

  it("rejects two files for one URL, naming both", async () => {
    const root = await createRoot({
      "src/pages/about.leaf": component,
      "src/pages/about/index.leaf": component,
    });
    await expect(
      resolveFarmRendererRoutes({ renderer: leafRenderer({ routes: flatRoutes }), root }),
    ).rejects.toThrow(
      `maps two files to the page "/about": ${path.join(root, "src/pages/about.leaf")} and ${path.join(root, "src/pages/about/index.leaf")}`,
    );
  });

  it("rejects route rules it can't use", async () => {
    const root = await createRoot({ "src/pages/index.leaf": component });
    await expect(
      resolveFarmRendererRoutes({ renderer: leafRenderer({ routes: () => ({}) as never }), root }),
    ).rejects.toThrow("must return an object with a `resolve(file)` method");
    await expect(
      resolveFarmRendererRoutes({
        renderer: leafRenderer({ routes: () => ({ dir: "../outside", resolve: () => null }) }),
        root,
      }),
    ).rejects.toThrow("which is outside");
    await expect(
      resolveFarmRendererRoutes({
        renderer: leafRenderer({
          routes: () => ({
            dir: "src/pages",
            resolve: () => {
              throw new Error("no rule for this file");
            },
          }),
        }),
        root,
      }),
    ).rejects.toThrow(
      `threw while resolving ${path.join(root, "src/pages/index.leaf")}: no rule for this file`,
    );
  });

  it("tells the mapped route files from the rest of the route directory", async () => {
    const root = await createRoot({
      "src/pages/index.leaf": component,
      "src/pages/_layout.leaf": component,
      "src/pages/_card.leaf": component,
      "src/pages/site.css": "p { color: red; }\n",
    });
    const manager = await discover(root, leafRenderer({ routes: flatRoutes }));
    const file = (name: string) => path.join(root, "src/pages", name);
    // Adding or removing any file there can change the routes.
    for (const name of ["index.leaf", "_card.leaf", "site.css", "new.leaf"]) {
      expect(manager.isRendererRouteFile(file(name)), name).toBe(true);
    }
    expect(manager.isRendererRouteFile(path.join(root, "src/other/page.leaf"))).toBe(false);
    // Editing one changes what a route renders only when it is a route's own file; a stylesheet
    // or a component keeps its hot update.
    expect(manager.isRendererRouteModule(file("index.leaf"))).toBe(true);
    expect(manager.isRendererRouteModule(file("_layout.leaf"))).toBe(true);
    expect(manager.isRendererRouteModule(file("_card.leaf"))).toBe(false);
    expect(manager.isRendererRouteModule(file("site.css"))).toBe(false);

    const folders = await createRoot({ "src/app/page.leaf": component });
    const plain = await discover(folders, leafRenderer());
    expect(plain.isRendererRouteFile(path.join(folders, "src/app/page.leaf"))).toBe(false);
    expect(plain.isRendererRouteModule(path.join(folders, "src/app/page.leaf"))).toBe(false);
  });

  it("serves the mapped files from Farm's route table", async () => {
    const root = await createRoot({
      "src/pages/_layout.leaf": component,
      "src/pages/index.leaf": component,
      "src/pages/blog/_layout.leaf": component,
      "src/pages/blog/[slug].leaf": component,
      "src/pages/docs/[...path].leaf": component,
      "src/pages/_404.leaf": component,
    });
    const manager = await discover(root, leafRenderer({ routes: flatRoutes }));

    const match = manager.matchRoute("/blog/first-post");
    expect(match.route?.pattern).toBe("/blog/[slug]");
    expect(match.params).toEqual({ slug: "first-post" });
    expect(match.route?.modulePath).toBe(path.join(root, "src/pages/blog/[slug].leaf"));
    expect(match.layouts.map((layout) => layout.modulePath)).toEqual([
      path.join(root, "src/pages/_layout.leaf"),
      path.join(root, "src/pages/blog/_layout.leaf"),
    ]);
    expect(manager.matchRoute("/docs/a/b").route?.pattern).toBe("/docs/[...path]");
    expect(manager.matchRoute("/").route?.modulePath).toBe(path.join(root, "src/pages/index.leaf"));
    expect(manager.matchRoute("/_layout").route).toBeNull();
    expect(manager.getRendererNotFoundPath()).toBe(path.join(root, "src/pages/_404.leaf"));
    expect(manager.isRendererRouteFile(path.join(root, "src/pages/new.leaf"))).toBe(true);
    expect(manager.isRendererRouteFile(path.join(root, "src/components/badge.leaf"))).toBe(false);
  });

  it("reports no not-found page when the rules map none, and Farm's lookup otherwise", async () => {
    const root = await createRoot({
      "src/pages/index.leaf": component,
      "src/app/page.leaf": component,
    });
    expect(
      (await discover(root, leafRenderer({ routes: flatRoutes }))).getRendererNotFoundPath(),
    ).toBeNull();
    expect((await discover(root, leafRenderer())).getRendererNotFoundPath()).toBeUndefined();
  });

  it("finds new files under the rules' directory when discovery runs again", async () => {
    const root = await createRoot({ "src/pages/index.leaf": component });
    const manager = await discover(root, leafRenderer({ routes: flatRoutes }));
    expect(manager.matchRoute("/soil").route).toBeNull();
    await fs.writeFile(path.join(root, "src/pages/soil.leaf"), component);
    await manager.discoverRoutes();
    expect(manager.matchRoute("/soil").route?.modulePath).toBe(
      path.join(root, "src/pages/soil.leaf"),
    );
  });

  it("lists the mapped pages in the generated route types", async () => {
    const root = await createRoot({
      "src/pages/index.leaf": component,
      "src/pages/blog/[slug].leaf": component,
      "src/pages/blog/_layout.leaf": component,
      "src/pages/_404.leaf": component,
      "src/app/legacy/page.leaf": component,
    });
    const scan = await scanRoutePatterns({
      root,
      srcDir: "src",
      componentExtensions: [".leaf"],
      renderer: leafRenderer({ routes: flatRoutes }),
    });
    expect([...scan.pages].sort()).toEqual(["/", "/blog/[slug]"]);
    expect([...scan.modules].sort()).toEqual(["/", "/blog", "/blog/[slug]"]);
  });
});

describe("renderer hydration", () => {
  const hydrateSyntax: NonNullable<FarmRenderer["hydration"]>["resolve"] = (source) => {
    const match = /^\s*\/\/ @hydrate(?: (\w+))?\s*$/m.exec(source);
    if (!match) return undefined;
    return match[1] === "false"
      ? { hydrate: false }
      : { hydrate: true, ...(match[1] ? { strategy: match[1] as never } : {}) };
  };

  it("hydrates pages and layouts by the renderer's defaults", async () => {
    const root = await createRoot({
      "src/app/layout.leaf": component,
      "src/app/page.leaf": component,
    });
    const manager = await discover(
      root,
      leafRenderer({ hydration: { pages: true, layouts: false, strategy: "idle" } }),
    );
    expect(hydrationOf(manager, root, "/")).toEqual({
      shouldHydrate: true,
      islandStrategy: "idle",
    });
    expect(layoutHydrationOf(manager, root, "/")).toEqual({
      shouldHydrate: false,
      islandStrategy: null,
    });
  });

  it('gives a "use client" layout the renderer\'s default strategy', async () => {
    const root = await createRoot({
      "src/app/layout.tsx":
        '"use client";\nexport default function Layout(props) { return props.children; }\n',
      "src/app/page.leaf": component,
    });
    const manager = await discover(root, leafRenderer({ hydration: { strategy: "idle" } }));
    // "use client" hydrates the layout without a `hydrate` value, so the default still applies.
    expect(layoutHydrationOf(manager, root, "/")).toEqual({
      shouldHydrate: true,
      islandStrategy: "idle",
    });
    expect(hydrationOf(manager, root, "/")).toEqual({ shouldHydrate: false, islandStrategy: null });
  });

  it("lets a route rule hydrate its file, over the defaults", async () => {
    const root = await createRoot({
      "src/pages/index.leaf": component,
      "src/pages/watering.client.leaf": component,
    });
    const manager = await discover(
      root,
      leafRenderer({ routes: flatRoutes, hydration: { pages: false } }),
    );
    expect(hydrationOf(manager, root, "/").shouldHydrate).toBe(false);
    expect(hydrationOf(manager, root, "/watering")).toEqual({
      shouldHydrate: true,
      islandStrategy: "visible",
    });
  });

  it("reads the renderer's own syntax, over the route rule and the defaults", async () => {
    const root = await createRoot({
      "src/pages/index.leaf": "<script module>\n// @hydrate interaction\n</script>\n<p>home</p>\n",
      "src/pages/quiet.client.leaf":
        "<script module>\n// @hydrate false\n</script>\n<p>quiet</p>\n",
      "src/pages/plain.leaf": component,
    });
    const manager = await discover(
      root,
      leafRenderer({ routes: flatRoutes, hydration: { pages: false, resolve: hydrateSyntax } }),
    );
    expect(hydrationOf(manager, root, "/")).toEqual({
      shouldHydrate: true,
      islandStrategy: "interaction",
    });
    expect(hydrationOf(manager, root, "/quiet").shouldHydrate).toBe(false);
    expect(hydrationOf(manager, root, "/plain").shouldHydrate).toBe(false);
  });

  it("lets a file's export const hydrate win over the renderer's defaults", async () => {
    const root = await createRoot({
      "src/app/page.leaf":
        "<script module>\nexport const hydrate = false;\n</script>\n<p>home</p>\n",
      "src/app/about/page.leaf":
        '<script module>\nexport const island = "visible";\n</script>\n<p>about</p>\n',
    });
    const manager = await discover(root, leafRenderer({ hydration: { pages: true } }));
    expect(hydrationOf(manager, root, "/").shouldHydrate).toBe(false);
    expect(hydrationOf(manager, root, "/about")).toEqual({
      shouldHydrate: true,
      islandStrategy: "visible",
    });
  });

  it("fails when a file's syntax and its export disagree", async () => {
    const root = await createRoot({
      "src/app/page.leaf":
        "<script module>\n// @hydrate\nexport const hydrate = false;\n</script>\n<p>home</p>\n",
    });
    const manager = await discover(root, leafRenderer({ hydration: { resolve: hydrateSyntax } }));
    expect(() => manager.generateClientManifest(root)).toThrow(
      "sets its hydration twice: `export const hydrate = false` and renderer `leaf`'s syntax, which says true",
    );
  });

  it("names the file when the renderer's syntax returns something Farm can't use", async () => {
    const root = await createRoot({ "src/app/page.leaf": component });
    const manager = await discover(
      root,
      leafRenderer({ hydration: { resolve: () => ({ strategy: "eventually" as never }) } }),
    );
    expect(() => manager.generateClientManifest(root)).toThrow(
      `hydration.resolve() for ${path.join(root, "src/app/page.leaf")} returned \`strategy: "eventually"\``,
    );
  });

  it("leaves .tsx files to Farm's reader and needs no renderer settings", async () => {
    const renderer = leafRenderer({ hydration: { resolve: () => ({ hydrate: false }) } });
    const root = await createRoot({
      "src/app/page.tsx":
        "export const hydrate = true;\nexport default function Page() { return null; }\n",
    });
    expect(hydrationOf(await discover(root, renderer), root, "/").shouldHydrate).toBe(true);
    // The renderer's syntax says false for every .leaf file, and this one's export says true.
    const conflicting = await createRoot({
      "src/app/page.leaf":
        "<script module>\nexport const hydrate = true;\n</script>\n<p>home</p>\n",
    });
    const manager = await discover(conflicting, renderer);
    expect(() => manager.generateClientManifest(conflicting)).toThrow("sets its hydration twice");

    const plain = await createRoot({
      "src/app/page.leaf":
        "<script module>\nexport const hydrate = true;\n</script>\n<p>home</p>\n",
    });
    expect(hydrationOf(await discover(plain, leafRenderer()), plain, "/").shouldHydrate).toBe(true);
  });
});

describe("renderer compile()", () => {
  // A small stand-in for a renderer's own format: a module script, then markup the component
  // returns. compile() turns it into the TSX module the renderer's Vite plugin would emit.
  const compile: NonNullable<FarmRenderer["compile"]> = (source) => {
    const script = /<script module>([\s\S]*?)<\/script>/.exec(source)?.[1]?.trim() ?? "";
    const markup = source.replace(/<script module>[\s\S]*?<\/script>/, "").trim();
    return `${script}\nexport default function Component(props) {\n  return (<>${markup}</>);\n}\n`;
  };
  const islandsRenderer = (overrides: Partial<FarmRenderer> = {}) =>
    leafRenderer({ capabilities: { islands: true }, ...overrides });
  const files = {
    "src/components/plant.leaf":
      '<script module>\n"use client";\n</script>\n<button>plant</button>\n',
    "src/app/page.leaf":
      '<script module>\nimport Plant from "../components/plant.leaf";\n</script>\n<section><Plant label="a" /></section>\n',
  };

  async function discoverIslands(root: string, renderer: FarmRenderer) {
    const manager = new RouteManager({
      root,
      srcDir: "src",
      renderer,
      experimental: { isolatedClientHydration: "enabled" },
    } as Required<FarmConfig>);
    managers.push(manager);
    await manager.discoverRoutes();
    return manager;
  }

  it("plans an island for a client component in the renderer's own format", async () => {
    const root = await createRoot(files);
    const plant = path.join(root, "src/components/plant.leaf");

    const compiled = await discoverIslands(root, islandsRenderer({ compile }));
    expect([...compiled.getIsolatedClientBoundaryModules(root)]).toEqual([plant]);

    // Without compile(), Farm reads the file as written and finds no "use client" in it.
    const asWritten = await discoverIslands(root, islandsRenderer());
    expect([...asWritten.getIsolatedClientBoundaryModules(root)]).toEqual([]);
  });

  it("hands hydration.resolve() the file as written, before compile()", async () => {
    const page = "<script module>\n// @hydrate visible\n</script>\n<p>home</p>\n";
    const root = await createRoot({ "src/app/page.leaf": page });
    const sources: string[] = [];
    const manager = await discover(
      root,
      leafRenderer({
        // Drops comments, so only the source as written still has the pragma.
        compile: (source) => compile(source.replace(/\/\/.*$/gm, ""), ""),
        hydration: {
          resolve(source) {
            sources.push(source);
            return /@hydrate visible/.test(source) ? { hydrate: true, strategy: "visible" } : {};
          },
        },
      }),
    );
    expect(hydrationOf(manager, root, "/")).toEqual({
      shouldHydrate: true,
      islandStrategy: "visible",
    });
    expect(new Set(sources)).toEqual(new Set([page]));
  });

  it("leaves other extensions to Farm's reader", async () => {
    const root = await createRoot({
      "src/app/page.tsx":
        'export const island = "visible";\nexport const hydrate = true;\nexport default function Page() { return null; }\n',
    });
    const manager = await discover(
      root,
      leafRenderer({
        compile: () => {
          throw new Error("only .leaf files compile");
        },
      }),
    );
    expect(hydrationOf(manager, root, "/")).toEqual({
      shouldHydrate: true,
      islandStrategy: "visible",
    });
  });

  it("names the file when compile() throws or returns no source", async () => {
    const root = await createRoot({ "src/app/page.leaf": component });
    const page = path.join(root, "src/app/page.leaf");
    const failure = new Error("unclosed <p>");
    const throwing = await discover(
      root,
      leafRenderer({
        compile: () => {
          throw failure;
        },
      }),
    );
    let thrown: unknown;
    try {
      throwing.generateClientManifest(root);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toBe(
      `Renderer \`leaf\` compile() for ${page} threw: unclosed <p>`,
    );
    expect((thrown as Error & { cause?: unknown }).cause).toBe(failure);

    const empty = await discover(root, leafRenderer({ compile: () => undefined as never }));
    expect(() => empty.generateClientManifest(root)).toThrow(
      `Renderer \`leaf\` compile() for ${page} returned undefined. Return the module the file compiles to, as JavaScript or TSX source.`,
    );
  });
});

describe("renderer descriptor checks", () => {
  it("reports every bad routes and hydration field at once", () => {
    expect(() =>
      resolveFarmRenderer({
        ...leafRenderer(),
        routes: "src/pages" as never,
        hydration: { pages: "yes", strategy: "soon", resolve: 1 } as never,
        compile: "leaf" as never,
      }),
    ).toThrow(
      [
        "Farm renderer `leaf` is invalid:",
        "- `routes` must be a method that returns `{ dir?, resolve(file) }`.",
        "- `hydration.pages` must be true or false.",
        '- `hydration.strategy` must be "load", "idle", "visible", or "interaction"; got "soon".',
        "- `hydration.resolve` must be a method that reads a file's source.",
        "- `compile` must be a method that returns a file's JavaScript or TSX.",
      ].join("\n"),
    );
  });

  it("keeps the routes, hydration and compile methods on the resolved renderer", () => {
    const routes = flatRoutes!;
    const resolve = () => undefined;
    const compile = (source: string) => source;
    const resolved = resolveFarmRenderer(
      leafRenderer({ routes, hydration: { pages: true, resolve }, compile }),
    );
    expect(resolved.routes).toBe(routes);
    expect(resolved.hydration).toEqual({ pages: true, resolve });
    expect(resolved.compile).toBe(compile);
  });
});
