import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getClientModuleHydrationPlan,
  getClientModuleMetadata,
  getMarkdownPageHydrationPlan,
  isFarmPackageClientBoundary,
  withFarmSourceSnapshot,
} from "../utils/client-component";
import { resolveConfig } from "../config";
import { RouteManager } from "../routing/route-manager";
import { FarmSourceSnapshotStore, withFarmSourceSnapshotOf } from "../utils/source-snapshot";
import {
  dropLatestPackageClientBoundaryCache,
  runWithPackageClientBoundaryCacheFile,
  usePackageClientBoundaryCacheFile,
  withPackageClientBoundaryCache,
} from "../utils/package-client-boundary-cache";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  dropLatestPackageClientBoundaryCache();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
}

/**
 * An app whose pages reach package client components through barrels, subpath exports that share
 * internal files, deferred island strategies, a cycle, and server-only packages.
 */
function createProject(): { root: string; cacheFile: string; modules: string[] } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-package-boundary-")));
  tempDirs.push(root);
  const icons = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `node_modules/ui-kit/dist/icons/icon-${index}.js`,
      `export default function Icon${index}() { return null; }\n`,
    ]),
  );
  writeFiles(root, {
    "node_modules/ui-kit/package.json": JSON.stringify({
      name: "ui-kit",
      exports: {
        ".": { import: "./dist/index.js" },
        "./extra": "./dist/extra.js",
        "./icons": "./dist/icons/index.js",
      },
    }),
    "node_modules/ui-kit/dist/index.js":
      'export * from "./button.js";\nexport { Card } from "./card/index.js";\nexport * from "./icons/index.js";\n',
    "node_modules/ui-kit/dist/button.js":
      '"use client";\nexport const island = "visible";\nexport function Button() { return null; }\n',
    "node_modules/ui-kit/dist/card/index.js":
      'import { Body } from "./body";\nexport function Card() { return Body(); }\n',
    "node_modules/ui-kit/dist/card/body/index.js": "export function Body() { return null; }\n",
    "node_modules/ui-kit/dist/extra.js":
      'import { Button } from "./button.js";\nimport { cycle } from "./cycle-a.js";\nexport function Extra() { return [Button, cycle]; }\n',
    "node_modules/ui-kit/dist/cycle-a.js":
      'import { b } from "./cycle-b.js";\nexport const cycle = b;\n',
    "node_modules/ui-kit/dist/cycle-b.js":
      'import { cycle } from "./cycle-a.js";\nexport const b = () => cycle;\n',
    "node_modules/ui-kit/dist/icons/index.js": Object.keys(icons)
      .map(
        (file) =>
          `export { default as ${path.basename(file, ".js").replace("-", "")} } from "./${path.basename(file)}";`,
      )
      .join("\n"),
    ...icons,
    "node_modules/server-utils/package.json": JSON.stringify({
      name: "server-utils",
      main: "./lib/index.js",
    }),
    "node_modules/server-utils/lib/index.js":
      'export * from "./format";\nimport "ui-kit";\nexport const ok = true;\n',
    "node_modules/server-utils/lib/format/index.js":
      "export const format = (value) => String(value);\n",
    "src/components/toolbar.tsx":
      'import { Button } from "ui-kit";\nimport { Extra } from "ui-kit/extra";\nexport function Toolbar() { return <><Button /><Extra /></>; }\n',
    "src/components/client-nav.tsx":
      '"use client";\nimport { Icon1 } from "ui-kit/icons";\nexport function ClientNav() { return <Icon1 />; }\n',
    "src/app/layout.tsx":
      'import { Toolbar } from "../components/toolbar";\nexport default function Layout({ children }) { return <><Toolbar />{children}</>; }\n',
    "src/app/page.tsx":
      'import { Card } from "ui-kit";\nimport { format } from "server-utils";\nexport default function Page() { return <Card>{format(1)}</Card>; }\n',
    "src/app/docs/page.tsx":
      'import { ClientNav } from "../../components/client-nav";\nimport { Extra } from "ui-kit/extra";\nimport { Button } from "ui-kit";\nexport default async function Docs() { return <><ClientNav /><Extra /><Button /></>; }\n',
    "src/app/blog/page.tsx":
      'import { ClientNav } from "../../components/client-nav";\nimport { ok } from "server-utils";\nexport default function Blog() { return ok ? <ClientNav /> : null; }\n',
    "src/app/about/page.tsx":
      'import { format } from "server-utils";\nexport default function About() { return format(1); }\n',
    "src/mdx-components.tsx":
      'import { Icon2 } from "ui-kit/icons";\nimport { ClientNav } from "./components/client-nav";\nexport const components = { Icon2, ClientNav };\n',
  });
  const modules = [
    "layout.tsx",
    "page.tsx",
    "docs/page.tsx",
    "blog/page.tsx",
    "about/page.tsx",
  ].map((file) => path.join(root, "src", "app", file));
  return { root, cacheFile: path.join(root, ".farm", "cache", "client-boundaries.json"), modules };
}

/** Every plan a production build computes for the project, in the order it computes them. */
function planProject(root: string, modules: string[]) {
  return {
    metadata: modules.map((modulePath) => getClientModuleMetadata(modulePath, root)),
    off: modules.map((modulePath) =>
      getClientModuleHydrationPlan(modulePath, root, "off", { asyncOwnerIslands: true }),
    ),
    enabled: modules.map((modulePath) =>
      getClientModuleHydrationPlan(modulePath, root, "enabled", { asyncOwnerIslands: true }),
    ),
    islands: modules.map((modulePath) =>
      getClientModuleHydrationPlan(modulePath, root, "off", {
        asyncOwnerIslands: true,
        serverOwners: true,
        serverTreeLayouts: true,
      }),
    ),
    markdown: getMarkdownPageHydrationPlan(
      path.join(root, "src", "mdx-components.tsx"),
      root,
      "off",
      {
        asyncOwnerIslands: true,
      },
    ),
  };
}

function planInBuild(root: string, modules: string[], cacheFile: string) {
  return withPackageClientBoundaryCache(async () => {
    usePackageClientBoundaryCacheFile(cacheFile);
    return planProject(root, modules);
  });
}

function countPackageReads(): { reads: string[] } {
  const reads: string[] = [];
  const readFileSync = fs.readFileSync;
  vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: []) => {
    if (typeof file === "string" && file.includes(`${path.sep}node_modules${path.sep}`)) {
      if (!file.endsWith(".json")) reads.push(file);
    }
    return readFileSync.call(fs, file, ...rest);
  }) as typeof fs.readFileSync);
  return { reads };
}

describe("package client-boundary cache", () => {
  it("plans identically without the cache, cold, and warm from the persisted file", async () => {
    const { root, cacheFile, modules } = createProject();
    const uncached = planProject(root, modules);
    // The fixture exercises package boundaries, async-owner islands, and route-wide fallbacks.
    expect(uncached.metadata.map((plan) => plan.shouldHydrate)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
    expect(uncached.off[2]).toMatchObject({ staticPackageBoundaries: ["ui-kit/extra", "ui-kit"] });
    expect(uncached.metadata[0].islandStrategy).toBe("visible");

    const cold = await planInBuild(root, modules, cacheFile);
    expect(fs.existsSync(cacheFile)).toBe(true);
    const { reads } = countPackageReads();
    const warm = await planInBuild(root, modules, cacheFile);

    expect(cold).toEqual(uncached);
    expect(warm).toEqual(uncached);
    expect(reads).toEqual([]);
  });

  it("inspects each package entry graph once per build and visited context", async () => {
    const { root, cacheFile, modules } = createProject();
    const icon = path.join(root, "node_modules", "ui-kit", "dist", "icons", "icon-7.js");

    const uncached = countPackageReads();
    planProject(root, modules);
    // Islands-mode plans reach package components through their client references, which
    // inspect each package entry once rather than again for a static-leaf check. One more read is
    // the export trace that decides which imported names are client components; it parses each
    // file once per process.
    expect(uncached.reads.filter((file) => file === icon)).toHaveLength(21);
    vi.restoreAllMocks();

    const build = countPackageReads();
    await planInBuild(root, modules, cacheFile);
    // Through `ui-kit` on its own; through `ui-kit` again for the docs page, which reaches it after
    // `ui-kit/extra` visited the button.js they share, so that inspection stops there and its
    // result can differ; and through the Markdown components' `ui-kit/icons` entry.
    expect(build.reads.filter((file) => file === icon)).toHaveLength(3);
    const readsPerFile = new Map<string, number>();
    for (const file of build.reads) readsPerFile.set(file, (readsPerFile.get(file) ?? 0) + 1);
    expect(Math.max(...readsPerFile.values())).toBe(3);
    expect(build.reads.length).toBeLessThan(uncached.reads.length / 3);
  });

  it("reinspects a package whose file changed size, content, or directory listing", async () => {
    const { root, cacheFile, modules } = createProject();
    const dist = path.join(root, "node_modules", "ui-kit", "dist");
    await planInBuild(root, modules, cacheFile);

    // Size changes: the button stops being a client component.
    fs.writeFileSync(path.join(dist, "button.js"), "export function Button() { return null; }\n");
    let warm = await planInBuild(root, modules, cacheFile);
    expect(warm).toEqual(planProject(root, modules));
    expect(warm.metadata[0].shouldHydrate).toBe(false);

    // npm writes every package file with one fixed mtime, so a same-size rewrite keeps size and
    // mtime: only ctime changes.
    const button = path.join(dist, "button.js");
    const fixed = new Date("1985-10-26T08:15:00Z");
    fs.utimesSync(button, fixed, fixed);
    await planInBuild(root, modules, cacheFile);
    const { size } = fs.statSync(button);
    const sameSize = '"use client";export function Button(){}'.padEnd(size - 1, " ") + "\n";
    expect(Buffer.byteLength(sameSize)).toBe(size);
    fs.writeFileSync(button, sameSize);
    fs.utimesSync(button, fixed, fixed);
    expect(fs.statSync(button).mtimeMs).toBe(fixed.getTime());
    warm = await planInBuild(root, modules, cacheFile);
    expect(warm).toEqual(planProject(root, modules));
    expect(warm.metadata[0].shouldHydrate).toBe(true);

    // A new file that `./format` now resolves to ahead of format/index.js, with no file changed.
    fs.writeFileSync(
      path.join(root, "node_modules", "server-utils", "lib", "format.js"),
      '"use client";\nexport const format = (value) => String(value);\n',
    );
    warm = await planInBuild(root, modules, cacheFile);
    expect(warm).toEqual(planProject(root, modules));
    expect(warm.metadata[4].shouldHydrate).toBe(true);
  });

  it.each([
    ["not JSON", "{not json"],
    ["truncated", '{"schema":1,"farm":"'],
    ["another schema", JSON.stringify({ schema: 0, farm: "x", paths: [], entries: {} })],
  ])("ignores a cache file that is %s", async (_name, contents) => {
    const { root, cacheFile, modules } = createProject();
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, contents);

    expect(await planInBuild(root, modules, cacheFile)).toEqual(planProject(root, modules));
    expect(() => JSON.parse(fs.readFileSync(cacheFile, "utf8"))).not.toThrow();
  });

  it("ignores persisted entries with an invalid shape", async () => {
    const { root, cacheFile, modules } = createProject();
    await planInBuild(root, modules, cacheFile);
    const stored = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const variants = Object.values(stored.entries).flat() as Array<Record<string, any>>;
    expect(variants.length).toBeGreaterThan(0);
    variants.forEach((entry, index) => {
      if (index % 2 === 0) entry.result.shouldHydrate = "yes";
      else entry.files = [stored.paths.length + 1];
    });
    fs.writeFileSync(cacheFile, JSON.stringify(stored));

    expect(await planInBuild(root, modules, cacheFile)).toEqual(planProject(root, modules));
  });

  it("rereads package sources on every inspection outside a production build", () => {
    const { root, cacheFile, modules } = createProject();
    expect(getClientModuleMetadata(modules[0], root).shouldHydrate).toBe(true);
    fs.writeFileSync(
      path.join(root, "node_modules", "ui-kit", "dist", "button.js"),
      "export function Button() { return null; }\n",
    );
    expect(getClientModuleMetadata(modules[0], root).shouldHydrate).toBe(false);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it("shares inspections across a dev plan and reads no package again on restart", async () => {
    const { root, cacheFile, modules } = createProject();
    const uncached = countPackageReads();
    const expected = planProject(root, modules);
    vi.restoreAllMocks();

    const cold = countPackageReads();
    expect(
      runWithPackageClientBoundaryCacheFile(cacheFile, () => planProject(root, modules)),
    ).toEqual(expected);
    // Written before the plan returns, so a dev server stopped right after startup keeps it.
    expect(fs.existsSync(cacheFile)).toBe(true);
    expect(cold.reads.length).toBeLessThan(uncached.reads.length / 3);
    vi.restoreAllMocks();

    const warm = countPackageReads();
    expect(
      runWithPackageClientBoundaryCacheFile(cacheFile, () => planProject(root, modules)),
    ).toEqual(expected);
    expect(warm.reads).toEqual([]);
  });

  it("reads a package again when it changes between dev plans", () => {
    const { root, cacheFile, modules } = createProject();
    const plan = () =>
      runWithPackageClientBoundaryCacheFile(cacheFile, () => planProject(root, modules));
    expect(plan().metadata[0].shouldHydrate).toBe(true);

    // A dependency reinstalled while the dev server runs.
    fs.writeFileSync(
      path.join(root, "node_modules", "ui-kit", "dist", "button.js"),
      "export function Button() { return null; }\n",
    );
    const replanned = plan();
    expect(replanned).toEqual(planProject(root, modules));
    expect(replanned.metadata[0].shouldHydrate).toBe(false);
  });

  it("uses the build's cache inside a build scope", async () => {
    const { root, cacheFile, modules } = createProject();
    const devCacheFile = path.join(root, ".farm", "cache", "dev.json");
    const plan = await withPackageClientBoundaryCache(async () => {
      usePackageClientBoundaryCacheFile(cacheFile);
      return runWithPackageClientBoundaryCacheFile(devCacheFile, () => planProject(root, modules));
    });
    expect(plan).toEqual(planProject(root, modules));
    expect(fs.existsSync(cacheFile)).toBe(true);
    expect(fs.existsSync(devCacheFile)).toBe(false);
  });

  it("keeps a route manager's plans in the dev cache file", async () => {
    const { root, cacheFile } = createProject();
    const config = await resolveConfig({ root, srcDir: "src" }, "development");
    const routeManager = new RouteManager(config);
    await routeManager.discoverRoutes();
    const uncached = routeManager.generateClientManifest(root);
    expect(fs.existsSync(cacheFile)).toBe(false);

    routeManager.usePackageClientBoundaryCacheFile(cacheFile);
    expect(routeManager.regenerateClientManifest(root)).toEqual(uncached);
    expect(fs.existsSync(cacheFile)).toBe(true);

    // A replan after a source edit, as the dev server makes, reads no package again.
    const { reads } = countPackageReads();
    expect(routeManager.regenerateClientManifest(root)).toEqual(uncached);
    expect(reads).toEqual([]);
  });

  it("reuses the latest dev plan's inspections in transforms until a watched change", async () => {
    const { root, cacheFile, modules } = createProject();
    const config = await resolveConfig({ root, srcDir: "src" }, "development");
    const routeManager = new RouteManager(config);
    await routeManager.discoverRoutes();
    routeManager.usePackageClientBoundaryCacheFile(cacheFile);
    routeManager.generateClientManifest(root);

    // A transform asks whether each package a module imports is a client boundary.
    const toolbar = path.join(root, "src", "components", "toolbar.tsx");
    const inspect = () =>
      routeManager.inspectPackages(() => isFarmPackageClientBoundary(toolbar, "ui-kit", root));
    const { reads } = countPackageReads();
    expect(inspect()).toBe(true);
    expect(inspect()).toBe(true);
    expect(reads).toEqual([]);
    vi.restoreAllMocks();

    // A dependency reinstalled while the dev server runs, then the change the watcher reports.
    fs.writeFileSync(
      path.join(root, "node_modules", "ui-kit", "dist", "button.js"),
      "export function Button() { return null; }\n",
    );
    dropLatestPackageClientBoundaryCache();
    expect(inspect()).toBe(isFarmPackageClientBoundary(toolbar, "ui-kit", root));
    expect(modules.length).toBeGreaterThan(0);
  });
});

describe("incremental dev replans", () => {
  async function plannedProject() {
    const project = createProject();
    const config = await resolveConfig({ root: project.root, srcDir: "src" }, "development");
    const fresh = async () => {
      const manager = new RouteManager(config);
      await manager.discoverRoutes();
      return manager.generateClientManifest(project.root);
    };
    const routeManager = new RouteManager(config);
    await routeManager.discoverRoutes();
    routeManager.trackSourceChanges();
    routeManager.generateClientManifest(project.root);
    return { ...project, routeManager, fresh };
  }

  function countSourceReads(): string[] {
    const reads: string[] = [];
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      ...rest: []
    ) => {
      if (typeof file === "string") reads.push(file);
      return readFileSync.call(fs, file, ...rest);
    }) as typeof fs.readFileSync);
    return reads;
  }

  it("replans only the route modules that read an edited file, as a full plan would", async () => {
    const { root, routeManager, fresh } = await plannedProject();
    const clientNav = path.join(root, "src", "components", "client-nav.tsx");
    fs.writeFileSync(
      clientNav,
      '"use client";\nimport { Icon1 } from "ui-kit/icons";\nexport const island = "idle";\nexport function ClientNav() { return <Icon1 />; }\n',
    );
    routeManager.noteSourceChange(clientNav, "update");
    const reads = countSourceReads();
    const replanned = routeManager.regenerateClientManifest(root);
    vi.restoreAllMocks();
    expect(replanned).toEqual(await fresh());
    expect(replanned.routes.find((route) => route.pattern === "/docs")).toMatchObject({
      isolatedBoundaries: [expect.objectContaining({ islandStrategy: "idle" })],
    });
    // Every module the edit did not change is answered from the kept snapshot.
    expect(new Set(reads.filter((file) => file.startsWith(path.join(root, "src"))))).toEqual(
      new Set([clientNav]),
    );
  });

  it("needs no replan for an edit inside a client component that keeps what plans read", async () => {
    const { root, routeManager, fresh } = await plannedProject();
    const clientNav = path.join(root, "src", "components", "client-nav.tsx");
    const original = fs.readFileSync(clientNav, "utf8");
    // The route types the dev server writes as it starts are not modules a plan reads.
    const types = path.join(root, "src", "farm.d.ts");
    fs.writeFileSync(types, "export {};\n");
    routeManager.noteSourceChange(types, "create");
    fs.writeFileSync(
      clientNav,
      original.replace("return <Icon1 />", "return <nav><Icon1 /></nav>"),
    );
    routeManager.noteSourceChange(clientNav, "update");
    expect(routeManager.isEditPlanNeutral(clientNav)).toBe(true);
    // The plan it keeps is the one a full plan makes.
    expect(routeManager.generateClientManifest(root)).toEqual(await fresh());

    // A deferred strategy changes what the plan reads.
    fs.writeFileSync(
      clientNav,
      original.replace("export function", 'export const island = "idle";\nexport function'),
    );
    expect(routeManager.isEditPlanNeutral(clientNav)).toBe(false);
    // A server module's JSX is read by plans.
    const toolbar = path.join(root, "src", "components", "toolbar.tsx");
    expect(routeManager.isEditPlanNeutral(toolbar)).toBe(false);
  });

  it("sees an edit the watcher did not report", async () => {
    const { root, routeManager, fresh } = await plannedProject();
    const clientNav = path.join(root, "src", "components", "client-nav.tsx");
    fs.writeFileSync(
      clientNav,
      '"use client";\nimport { Icon1 } from "ui-kit/icons";\nexport const island = "visible";\nexport function ClientNav() { return <Icon1 />; }\n',
    );
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(clientNav, future, future);
    const replanned = routeManager.regenerateClientManifest(root);
    expect(replanned).toEqual(await fresh());
    expect(replanned.routes.find((route) => route.pattern === "/docs")).toMatchObject({
      isolatedBoundaries: [expect.objectContaining({ islandStrategy: "visible" })],
    });
  });

  it("replans every route module after a source file is added", async () => {
    const { root, routeManager, fresh } = await plannedProject();
    const added = path.join(root, "src", "components", "added.tsx");
    fs.writeFileSync(added, "export const added = true;\n");
    routeManager.noteSourceChange(added, "create");
    const reads = countSourceReads();
    const replanned = routeManager.regenerateClientManifest(root);
    vi.restoreAllMocks();
    expect(replanned).toEqual(await fresh());
    expect(reads).toContain(path.join(root, "src", "app", "about", "page.tsx"));
  });

  it("replans every route module without tracking", async () => {
    const { root, routeManager } = await plannedProject();
    const config = await resolveConfig({ root, srcDir: "src" }, "development");
    const untracked = new RouteManager(config);
    await untracked.discoverRoutes();
    untracked.generateClientManifest(root);
    const reads = countSourceReads();
    untracked.regenerateClientManifest(root);
    vi.restoreAllMocks();
    expect(reads).toContain(path.join(root, "src", "app", "about", "page.tsx"));
    expect(routeManager).toBeDefined();
  });
});

describe("source snapshot", () => {
  it("plans the same and reads each shared module once across a plan's routes", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-source-snapshot-")));
    tempDirs.push(root);
    const files: Record<string, string> = {
      "src/ui/index.ts": Array.from(
        { length: 8 },
        (_, index) => `export { Part${index} } from "./part-${index}";`,
      ).join("\n"),
      "src/ui/counter.tsx":
        '"use client";\nimport { useState } from "react";\nexport function Counter() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; }\n',
    };
    for (let index = 0; index < 8; index++) {
      files[`src/ui/part-${index}.tsx`] =
        `export function Part${index}({ children }) { return <div>{children}</div>; }\n`;
    }
    const pages: string[] = [];
    for (let index = 0; index < 12; index++) {
      const page = `src/app/page-${index}/page.tsx`;
      files[page] =
        `import { Part${index % 8} } from "../../ui";\nimport { Counter } from "../../ui/counter";\nexport default async function Page() { return <Part${index % 8}><Counter /></Part${index % 8}>; }\n`;
      pages.push(path.join(root, page));
    }
    writeFiles(root, files);
    const plan = () =>
      pages.map((page) =>
        getClientModuleHydrationPlan(page, root, "off", {
          asyncOwnerIslands: true,
          serverOwners: true,
        }),
      );
    const expected = plan();
    expect(expected.every((entry) => entry.isolatedBoundaries.length === 1)).toBe(true);

    const reads: string[] = [];
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      ...rest: []
    ) => {
      if (typeof file === "string") reads.push(file);
      return readFileSync.call(fs, file, ...rest);
    }) as typeof fs.readFileSync);
    expect(withFarmSourceSnapshot(plan)).toEqual(expected);
    const barrel = path.join(root, "src", "ui", "index.ts");
    const counter = path.join(root, "src", "ui", "counter.tsx");
    expect(reads.filter((file) => file === barrel)).toHaveLength(1);
    expect(reads.filter((file) => file === counter)).toHaveLength(1);
  });

  it("answers a later analysis from an earlier plan's store without adding to it", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-source-snapshot-")));
    tempDirs.push(root);
    writeFiles(root, {
      "src/ui/index.ts": 'export { Counter } from "./counter";\n',
      "src/ui/counter.tsx":
        '"use client";\nimport { useState } from "react";\nexport function Counter() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; }\n',
      "src/app/a/page.tsx":
        'import { Counter } from "../../ui";\nexport default async function Page() { return <Counter />; }\n',
      "src/app/b/page.tsx":
        'import { Counter } from "../../ui";\nexport default async function Page() { return <main><Counter /></main>; }\n',
    });
    const plan = (page: string) =>
      getClientModuleHydrationPlan(path.join(root, "src/app", page, "page.tsx"), root, "off", {
        asyncOwnerIslands: true,
        serverOwners: true,
      });
    const expected = plan("b");
    // A build's store: filled by the route manager's plan, never stamped (nothing edits sources).
    const store = new FarmSourceSnapshotStore(false);
    withFarmSourceSnapshot(() => plan("a"), store);
    const size = () => [...store.entries.values()].reduce((total, scope) => total + scope.size, 0);
    const filled = size();
    expect(filled).toBeGreaterThan(0);

    const reads: string[] = [];
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      ...rest: []
    ) => {
      if (typeof file === "string") reads.push(file);
      return readFileSync.call(fs, file, ...rest);
    }) as typeof fs.readFileSync);
    expect(withFarmSourceSnapshotOf(store, () => plan("b"))).toEqual(expected);
    // The barrel and the client component come from the store; only the new page is read.
    expect(reads.filter((file) => file.startsWith(path.join(root, "src/ui")))).toEqual([]);
    expect(reads).toContain(path.join(root, "src/app/b/page.tsx"));
    expect(size()).toBe(filled);
  });
});
