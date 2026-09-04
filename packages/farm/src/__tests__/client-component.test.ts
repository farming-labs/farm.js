import { pathToFileURL } from "node:url";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getClientModuleHydrationPlan,
  getClientModuleMetadata,
  getIslandStrategyExport,
  hasHydrateExport,
  hasUseClientDirective,
  isClientComponentModule,
  resolveModuleSourcePath,
  shouldHydrateModule,
  stripUseClientDirective,
} from "../utils/client-component";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("client component path resolution", () => {
  it("detects and strips top-level client directives", () => {
    const source = '"use client";\n\nexport default function Page() { return null; }\n';

    expect(hasUseClientDirective(source)).toBe(true);
    expect(stripUseClientDirective(source)).toBe(
      "export default function Page() { return null; }\n",
    );
  });

  it("detects directives preceded by comments or other directives", () => {
    const afterBlockComment =
      '/* Copyright 2026 Acme */\n"use client";\nexport default function Counter() { return null; }\n';
    const afterLineComment =
      '// @generated\n"use client";\nexport default function Counter() { return null; }\n';
    const afterUseStrict =
      '"use strict";\n"use client";\nexport default function Counter() { return null; }\n';

    expect(hasUseClientDirective(afterBlockComment)).toBe(true);
    expect(hasUseClientDirective(afterLineComment)).toBe(true);
    expect(hasUseClientDirective(afterUseStrict)).toBe(true);

    expect(stripUseClientDirective(afterBlockComment)).toBe(
      "/* Copyright 2026 Acme */\nexport default function Counter() { return null; }\n",
    );
  });

  it("ignores use client strings that are not part of the directive prologue", () => {
    expect(hasUseClientDirective('const directive = "use client";\n')).toBe(false);
    expect(hasUseClientDirective('export default function Page() { return "use client"; }\n')).toBe(
      false,
    );
    expect(hasUseClientDirective('// just a comment mentioning "use client"\nconst x = 1;\n')).toBe(
      false,
    );
  });

  it("detects explicit hydrate exports", () => {
    expect(
      hasHydrateExport("export const hydrate = true;\nexport default function Page() {}"),
    ).toBe(true);
    expect(hasHydrateExport("const hydrate = true;\nexport default function Page() {}")).toBe(
      false,
    );
  });

  it("detects hydrate inside multi-name export lists and renames", () => {
    expect(hasHydrateExport("const hydrate = true;\nexport { hydrate, Widget };")).toBe(true);
    expect(hasHydrateExport("const hydrate = true;\nexport { Widget, hydrate };")).toBe(true);
    expect(hasHydrateExport("const flag = true;\nexport { flag as hydrate };")).toBe(true);
    // The exported name is what matters: hydrate renamed away is not an opt-in.
    expect(hasHydrateExport("const hydrate = true;\nexport { hydrate as flag };")).toBe(false);
    expect(hasHydrateExport("export { Widget };")).toBe(false);
  });

  it("resolves project-relative /src module paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-path-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath("/src/app/demo/page.tsx", root)).toBe(sourceFile);
    expect(isClientComponentModule("/src/app/demo/page.tsx", root)).toBe(true);
  });

  it("supports absolute module paths directly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-abs-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "page.tsx");
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath(sourceFile, root)).toBe(sourceFile);
    expect(isClientComponentModule(sourceFile, root)).toBe(true);
  });

  it("supports file urls and Vite /@fs/ module ids", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-virtual-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    const fileUrl = pathToFileURL(sourceFile).href;
    const fsId = `/@fs/${sourceFile.split(path.sep).join("/").replace(/^\/+/, "")}`;

    expect(resolveModuleSourcePath(fileUrl, root)).toBe(sourceFile);
    expect(isClientComponentModule(fileUrl, root)).toBe(true);
    expect(resolveModuleSourcePath(fsId, root)).toBe(sourceFile);
    expect(isClientComponentModule(fsId, root)).toBe(true);
  });

  it("supports hydratable server pages through export const hydrate = true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-hydrate-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "export const hydrate = true;\nexport default function Page() { return null; }\n",
    );

    expect(getClientModuleMetadata(sourceFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
      islandStrategy: "load",
    });
    expect(isClientComponentModule(sourceFile, root)).toBe(false);
    expect(shouldHydrateModule(sourceFile, root)).toBe(true);
  });

  it("detects hydrate exports in Svelte route modules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-svelte-hydrate-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "page.svelte");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      '<script module lang="ts">\n  export const hydrate = true;\n</script>\n<h1>Svelte</h1>\n',
    );

    expect(resolveModuleSourcePath("/src/app/page.svelte", root)).toBe(sourceFile);
    expect(getClientModuleMetadata(sourceFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
      islandStrategy: "load",
    });
  });

  it("hydrates a server page automatically when it imports a client component", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-import-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    const clientFile = path.join(root, "src", "app", "demo", "home-client.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(clientFile, '"use client";\nexport function HomeClient() { return null; }\n');
    fs.writeFileSync(
      pageFile,
      'import { HomeClient } from "./home-client";\nexport default function Page() { return <HomeClient />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
      islandStrategy: "load",
    });
    expect(isClientComponentModule(pageFile, root)).toBe(false);
    expect(shouldHydrateModule(pageFile, root)).toBe(true);
  });

  it("isolates a supported client leaf only in enabled mode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-isolated-client-plan-"));
    tempDirs.push(root);
    const layoutFile = path.join(root, "src", "app", "layout.tsx");
    const counterFile = path.join(root, "src", "components", "counter.tsx");
    fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
    fs.mkdirSync(path.dirname(counterFile), { recursive: true });
    fs.writeFileSync(
      counterFile,
      `'use client';\nexport default function Counter() { return <button>1</button>; }\n`,
    );
    fs.writeFileSync(
      layoutFile,
      `import Counter from "../components/counter";\nexport default function Layout({ children }) { return <main><Counter />{children}</main>; }\n`,
    );

    const analyzed = getClientModuleHydrationPlan(layoutFile, root, "analyze");
    expect(analyzed).toMatchObject({
      shouldHydrate: true,
      isolatedHydrationEligible: true,
      hasIsolatedClientBoundaries: false,
    });
    expect(analyzed.isolatedBoundaries).toEqual([
      { modulePath: counterFile, islandStrategy: "load" },
    ]);

    const enabled = getClientModuleHydrationPlan(layoutFile, root, "enabled");
    expect(enabled).toMatchObject({
      shouldHydrate: false,
      legacyShouldHydrate: true,
      isolatedHydrationEligible: true,
      hasIsolatedClientBoundaries: true,
    });
  });

  it("keeps unsupported client export graphs on route-wide hydration", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-isolated-client-fallback-"));
    tempDirs.push(root);
    const pageFile = path.join(root, "src", "app", "page.tsx");
    const clientFile = path.join(root, "src", "client.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      clientFile,
      `'use client';\nfunction Counter() { return null; }\nexport { Counter };\n`,
    );
    fs.writeFileSync(
      pageFile,
      `import { Counter } from "../client";\nexport default function Page() { return <Counter />; }\n`,
    );

    expect(getClientModuleHydrationPlan(pageFile, root, "enabled")).toMatchObject({
      shouldHydrate: true,
      isolatedHydrationEligible: false,
      hasIsolatedClientBoundaries: false,
      fallbackReason: expect.stringContaining("unsupported export shape"),
    });
  });

  it("detects client boundaries exposed by package export maps", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-package-import-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "layout.tsx");
    const packageRoot = path.join(root, "node_modules", "@acme", "analytics");
    fs.mkdirSync(path.join(packageRoot, "dist", "react"), { recursive: true });
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@acme/analytics",
        type: "module",
        exports: {
          "./react": {
            types: "./dist/react/index.d.ts",
            import: "./dist/react/index.mjs",
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist", "react", "index.mjs"),
      `'use client';\nexport function Analytics() { return null; }\n`,
    );
    fs.writeFileSync(
      pageFile,
      `import { Analytics } from "@acme/analytics/react";\nexport default function Layout({ children }) { return <><Analytics />{children}</>; }\n`,
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
      islandStrategy: "load",
    });
  });

  it("follows package-relative re-exports to a client boundary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-package-reexport-"));
    tempDirs.push(root);

    const layoutFile = path.join(root, "src", "app", "layout.tsx");
    const packageRoot = path.join(root, "node_modules", "analytics-react");
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "analytics-react", exports: "./dist/index.js" }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist", "index.js"),
      'export { Analytics } from "./client.js";\n',
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist", "client.js"),
      '"use client";\nexport function Analytics() { return null; }\n',
    );
    fs.writeFileSync(
      layoutFile,
      'import { Analytics } from "analytics-react";\nexport default function Layout() { return <Analytics />; }\n',
    );

    expect(getClientModuleMetadata(layoutFile, root).shouldHydrate).toBe(true);
  });

  it("follows extensionless package directory re-exports to a client boundary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-package-directory-"));
    tempDirs.push(root);

    const layoutFile = path.join(root, "src", "app", "layout.tsx");
    const packageRoot = path.join(root, "node_modules", "directory-client");
    fs.mkdirSync(path.join(packageRoot, "dist", "client"), { recursive: true });
    fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "directory-client", exports: "./dist/index.js" }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist", "index.js"),
      'export { DirectoryClient } from "./client";\n',
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist", "client", "index.js"),
      '"use client";\nexport function DirectoryClient() { return null; }\n',
    );
    fs.writeFileSync(
      layoutFile,
      'import { DirectoryClient } from "directory-client";\nexport default function Layout() { return <DirectoryClient />; }\n',
    );

    expect(getClientModuleMetadata(layoutFile, root).shouldHydrate).toBe(true);
  });

  it("resolves package entries selected by the node export condition", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-package-node-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "page.tsx");
    const packageRoot = path.join(root, "node_modules", "node-conditioned-client");
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "node-conditioned-client",
        exports: { node: "./dist/node.js", default: "./dist/default.js" },
      }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist", "node.js"),
      '"use client";\nexport function NodeClient() { return null; }\n',
    );
    fs.writeFileSync(path.join(packageRoot, "dist", "default.js"), "export {};\n");
    fs.writeFileSync(
      pageFile,
      'import { NodeClient } from "node-conditioned-client";\nexport default function Page() { return <NodeClient />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root).shouldHydrate).toBe(true);
  });

  it("prefers browser package exports even when node is declared first", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-package-browser-"));
    tempDirs.push(root);

    const layoutFile = path.join(root, "src", "app", "layout.tsx");
    const packageRoot = path.join(root, "node_modules", "conditional-client");
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "conditional-client",
        exports: {
          node: "./dist/node.js",
          browser: "./dist/browser.js",
        },
      }),
    );
    fs.writeFileSync(path.join(packageRoot, "dist", "node.js"), "export {};\n");
    fs.writeFileSync(
      path.join(packageRoot, "dist", "browser.js"),
      '"use client";\nexport function BrowserClient() { return null; }\n',
    );
    fs.writeFileSync(
      layoutFile,
      'import { BrowserClient } from "conditional-client";\nexport default function Layout() { return <BrowserClient />; }\n',
    );

    expect(getClientModuleMetadata(layoutFile, root).shouldHydrate).toBe(true);
  });

  it("ignores type-only and non-code package import examples", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-package-types-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "page.tsx");
    const packageRoot = path.join(root, "node_modules", "client-types");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "client-types", exports: "./index.js" }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "index.js"),
      '"use client";\nexport function ClientWidget() { return null; }\n',
    );
    fs.writeFileSync(
      pageFile,
      [
        'import type { ClientWidget } from "client-types";',
        'import { type ClientWidget as NamedClientWidget, } from "client-types";',
        'export type { ClientWidget as ExportedWidget } from "client-types";',
        '// import { ClientWidget } from "client-types";',
        "const quoted = 'import { ClientWidget } from \"client-types\";';",
        'const example = `import { ClientWidget } from "client-types";`;',
        'const pattern = /import { ClientWidget } from "client-types"/;',
        'function Example() { return <p>import { ClientWidget } from "client-types"</p>; }',
        "export default function Page() { return quoted + example + String(pattern) + String(Example); }",
      ].join("\n"),
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: false,
      islandStrategy: null,
    });
  });

  it("keeps an async server page server-only when it imports a client component", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-async-import-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    const clientFile = path.join(root, "src", "app", "demo", "star-button.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(clientFile, '"use client";\nexport function StarButton() { return null; }\n');
    fs.writeFileSync(
      pageFile,
      'import { StarButton } from "./star-button";\nexport default async function Page() { const data = await fetch("/api/repo"); return <StarButton data={data} />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: false,
      islandStrategy: null,
      suppressedAsyncHydration: true,
    });
    expect(shouldHydrateModule(pageFile, root)).toBe(false);
  });

  it("detects async arrow and indirect async default exports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-async-variants-"));
    tempDirs.push(root);

    const appDir = path.join(root, "src", "app", "demo");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "widget.tsx"),
      '"use client";\nexport function Widget() { return null; }\n',
    );

    const arrowPage = path.join(appDir, "arrow.tsx");
    fs.writeFileSync(
      arrowPage,
      'import { Widget } from "./widget";\nexport default async () => { await Promise.resolve(); return <Widget />; };\n',
    );
    expect(shouldHydrateModule(arrowPage, root)).toBe(false);

    const indirectPage = path.join(appDir, "indirect.tsx");
    fs.writeFileSync(
      indirectPage,
      'import { Widget } from "./widget";\nasync function Page() { return <Widget />; }\nexport default Page;\n',
    );
    expect(shouldHydrateModule(indirectPage, root)).toBe(false);

    const constPage = path.join(appDir, "const.tsx");
    fs.writeFileSync(
      constPage,
      'import { Widget } from "./widget";\nconst Page = async () => <Widget />;\nexport default Page;\n',
    );
    expect(shouldHydrateModule(constPage, root)).toBe(false);
  });

  it("suppresses an explicit hydrate export on async server pages", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-async-hydrate-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      pageFile,
      "export const hydrate = true;\nexport default async function Page() { return null; }\n",
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: false,
      islandStrategy: null,
      suppressedAsyncHydration: true,
    });
  });

  it("still hydrates synchronous pages whose imports include client components", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-sync-import-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    const clientFile = path.join(root, "src", "app", "demo", "widget.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(clientFile, '"use client";\nexport function Widget() { return null; }\n');
    fs.writeFileSync(
      pageFile,
      'import { Widget } from "./widget";\nasync function loadData() { return fetch("/api"); }\nexport default function Page() { return <Widget loader={loadData} />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
      islandStrategy: "load",
    });
  });

  it("reads a static island strategy from client modules", () => {
    expect(
      getIslandStrategyExport(
        '"use client";\nexport const island = "interaction";\nexport function Copy() {}',
      ),
    ).toBe("interaction");
    expect(
      getIslandStrategyExport(`
// export const island = chooseStrategy();
const example = 'export const island = "idle"';
export const island = "visible" as const // hydrate near the viewport
export function Chart() {}
`),
    ).toBe("visible");
    expect(() => getIslandStrategyExport("export const island = getStrategy();")).toThrow(
      /must be a static/,
    );
  });

  it("ignores unrelated island exports in imported server modules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-shared-island-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      path.join(path.dirname(pageFile), "shared.ts"),
      "export const island = getDomainIsland();\nexport const value = 1;\n",
    );
    fs.writeFileSync(
      path.join(path.dirname(pageFile), "button.tsx"),
      '"use client";\nexport const island = "interaction";\nexport function Button() {}\n',
    );
    fs.writeFileSync(
      pageFile,
      'import { value } from "./shared";\nimport { Button } from "./button";\nexport default function Page() { return <Button data-value={value} />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root).islandStrategy).toBe("interaction");
  });

  it("propagates an imported client boundary island strategy to its route", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-island-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    const clientFile = path.join(root, "src", "app", "demo", "copy-button.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      clientFile,
      '"use client";\nexport const island = "interaction";\nexport function CopyButton() { return null; }\n',
    );
    fs.writeFileSync(
      pageFile,
      'import { CopyButton } from "./copy-button";\nexport default function Page() { return <CopyButton />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
      islandStrategy: "interaction",
    });
  });

  it("falls back to eager hydration when imported island strategies disagree", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-islands-mixed-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      path.join(path.dirname(pageFile), "copy.tsx"),
      '"use client";\nexport const island = "interaction";\nexport function Copy() { return null; }\n',
    );
    fs.writeFileSync(
      path.join(path.dirname(pageFile), "chart.tsx"),
      '"use client";\nexport const island = "visible";\nexport function Chart() { return null; }\n',
    );
    fs.writeFileSync(
      pageFile,
      'import { Copy } from "./copy";\nimport { Chart } from "./chart";\nexport default function Page() { return <><Copy /><Chart /></>; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root).islandStrategy).toBe("load");
  });

  it("preserves request-scoped server props when building ordinary hydration props", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf-8");

    expect(source).toMatch(
      /return \{\s+\.\.\.\(existingProps \|\| \{\}\),\s+params: parsedParams,/,
    );
  });

  it("reports a layout that fails to load, rather than dropping it quietly", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf-8");

    // Skipping a layout makes the client tree differ from the server's, so React
    // discards the server rendered markup for that branch. A warning is too quiet
    // for something that deletes visible UI.
    expect(source).not.toContain("console.warn('[Farm.js] Could not load layout:");
    expect(source).toContain("[Farm.js] Layout failed to load and was skipped: ");
    expect(source).toContain("server rendered markup for this route");

    // The same applies to a loading boundary that cannot be loaded.
    expect(source).not.toContain("console.warn('[Farm.js] Could not load loading boundary");
    expect(source).toContain("[Farm.js] Loading boundary failed to load and was skipped: ");
  });

  it("reports the failing loading module without masking the original error", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf-8");
    const start = source.indexOf("async function buildClientHydrationElement(");
    const end = source.indexOf("\n\nasync function loadLayoutComponents", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const emittedFunction = source.slice(start, end);
    const testableFunction = emittedFunction.replace(
      "import(/* @vite-ignore */ loadingModulePath)",
      "loadModule(loadingModulePath)",
    );
    expect(testableFunction).not.toBe(emittedFunction);

    const loadFailure = new Error("loading module failed");
    const React = {
      createElement(type: unknown, props: unknown, ...children: unknown[]) {
        return { type, props, children };
      },
      Suspense: Symbol("Suspense"),
    };
    const buildClientHydrationElement = new Function(
      "React",
      "loadModule",
      `return (${testableFunction});`,
    )(React, async () => {
      throw loadFailure;
    }) as (
      component: () => null,
      props: Record<string, unknown>,
      loadingModulePath: string,
    ) => Promise<{ type: unknown }>;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const Page = () => null;

    try {
      const element = await buildClientHydrationElement(Page, {}, "/src/app/loading.tsx");

      expect(element.type).toBe(Page);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Loading boundary failed to load and was skipped: /src/app/loading.tsx",
        ),
        loadFailure,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps the emitted diagnostics free of escapes the template literal would consume", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf-8");
    const start = source.indexOf("Layout failed to load and was skipped");
    expect(start).toBeGreaterThan(-1);

    // A backslash-n inside the surrounding template literal becomes a real
    // newline in the emitted client runtime, which breaks the JS string literal.
    const message = source.slice(start, start + 400);
    expect(message.includes(String.fromCharCode(92) + "n")).toBe(false);
  });

  it("composes every applicable layout in the development hydration runtime", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf-8");

    expect(source).toContain("const layoutComponentCache = new Map();");
    expect(source).toContain("async function loadLayoutComponents(layouts = [])");
    expect(source).toContain("for (const layout of layouts)");
    expect(source).toContain("function wrapWithLoadedLayouts(element, loadedLayouts, params)");
    expect(source).toContain("for (let index = loadedLayouts.length - 1; index >= 0; index--)");
    expect(source).toContain("const layouts = Array.isArray(window.__FARM_LAYOUTS__)");
    expect(source).toContain("? window.__FARM_LAYOUTS__");
    expect(source).toContain(": findLayouts(window.location.pathname);");
    expect(source).toMatch(
      /tryHydrateImportedPage\(\s+pageContainer,[\s\S]*?layouts,[\s\S]*?layoutShouldHydrate,/,
    );
    expect(source).not.toContain("layouts.find((layout) => layout.pattern === '/')");
    expect(source).not.toContain("'/src/app/layout.tsx'");
    expect(source).not.toContain("Could not preload layout:");
  });

  it("uses a document swap when generated SPA navigation leaves the app root", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf-8",
    );

    expect(source).toContain("if (!this.swapContent(html))");
    expect(source).toContain("window.location.href = href;");
    expect(
      source.match(
        /if \(options\.replace \|\| options\.action === "replace"\) window\.location\.replace\(url\.toString\(\)\);/g,
      ),
    ).toHaveLength(4);
    expect(source).toContain("if (!newRoot || !currentRoot) return this.swapDocument(doc);");
    expect(source).toContain("swapDocument: function(doc)");
    expect(source).toContain("document.body.innerHTML = doc.body.innerHTML;");
    expect(source).toContain("delete window.__farmDocsRuntime;");
    expect(source).toContain("script.replaceWith(freshScript);");
    expect(source).toContain('document.documentElement.dataset.farmDocsRuntime === "true"');
    expect(source).toContain("const swapped = await this.swapContent(");
    expect(source).toContain(
      "const targetUrl = new URL(targetPath || window.location.href, window.location.origin);",
    );
    expect(source).toContain("resetReactRoot();");
    expect(source.match(/reconcileFarmDocumentHead\(doc\);/g)).toHaveLength(2);
    expect(source).toContain("renderRouteInterception(selectedSlot, intercepted.slot, from, doc)");
    expect(source).toContain("reconcileFarmDocumentHead(nextDocument);");
    expect(source).not.toContain('const newMetas = doc.querySelectorAll("meta[name]")');
  });

  it("guards generated production HTML requests against stale deployments", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf-8",
    );

    expect(source).toContain("async function fetchFarmNavigationDocument(");
    expect(source).toContain("headers: createFarmDeploymentRequestHeaders(deploymentId, headers)");
    expect(source).toContain("isFarmDeploymentMismatchResponse(response, deploymentId)");
    expect(source).toContain(
      'window.dispatchEvent(new CustomEvent("farm:deployment-mismatch", { detail: error }))',
    );
    expect(source).toContain('if (error?.name === "FarmDeploymentMismatchError") return;');
    expect(source).toContain("this.fetchPage(pathname, false, false)");
    expect(source).toContain("this.fetchPage(pathname, interceptFrom, false, false)");
  });

  it("refreshes hydratable production routes from uncached server HTML", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf-8",
    );

    expect(source.match(/refresh: function\(options = \{\}\)/g)).toHaveLength(2);
    expect(source).toContain(
      'if (!options.refresh && matched?.route.navigation === "client-render")',
    );
    expect(source).toContain("options.refresh ? null : matchInterceptedRouteSlot(pathname, from)");
    expect(source).toContain("fetchPage: async function(url, interceptFrom, fresh = false");
    expect(source).toContain("if (fresh) this.clearPrefetchedPath(url)");
    expect(source).toContain("options.refresh === true,");
  });

  it("keeps the generated production router compatible with client navigation hooks", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf-8",
    );

    expect(source).toContain("getNavigationState: function()");
    expect(source).toContain("subscribeNavigation: function(listener)");
    expect(source).toContain("addBlocker: function(blocker)");
    expect(source).toContain("registerScrollElement: function(key, element)");
    expect(source).toContain("stripFarmBasePath(pathname)");
    expect(source).toContain("writePageState: function(action, state, href)");
    expect(source).toContain("runViewTransition: async function(enabled, callback)");
    expect(source.match(/getHashTargetElement\(url\.hash\)\?\.scrollIntoView\(\)/g)).toHaveLength(
      4,
    );
    expect(source).not.toContain("document.querySelector(url.hash)");
    expect(
      source.match(/isFarmExternalNavigationURL\(url, window\.location\.origin\)/g),
    ).toHaveLength(4);
    expect(source.match(/if \(hasAbsoluteNavigationHref\(href\)\) return;/g)).toHaveLength(2);
    expect(source).toContain('const href = element.getAttribute("href");');
    expect(
      source.match(
        /const href = anchor\.getAttribute\("href"\);\s+if \(!href\) return;\s+if \(anchor\.hasAttribute\("download"\)\) return;/g,
      ),
    ).toHaveLength(2);
    expect(source).toContain("this.observers.set(element, observer);");
    expect(source).toContain("createHistoryState(");
    expect(source).toContain("revertBlockedPopState: function(from)");
    expect(source).toContain('if (action === "pop") this.revertBlockedPopState(from)');
    expect(source.match(/spaRouter\.initializeHistory\(\);/g)).toHaveLength(2);
    expect(source.match(/void spaRouter\.handlePopState\(event\);/g)).toHaveLength(2);
    expect(source).toContain("currentPath: window.location.pathname + window.location.search");
    expect(source).toContain(
      'if (!options.refresh && action !== "pop" && to === this.currentPath)',
    );
    expect(source).toContain("this.currentPath = to;");
    expect(source).toContain("scheduleFarmIslandHydration");
    expect(source).toContain("pendingPageHydrationController?.abort()");
    expect(source.match(/const navigation = this\.startNavigation/g)).toHaveLength(2);
    expect(source).toContain(
      "if (!this.isCurrentNavigation(navigation, clientNavigation)) return;",
    );
    expect(source).toContain("navigation.controller.signal");
    expect(source).toContain("navigation.clientNavigation = clientNavigation;");
    expect(source).toContain("farmClientRuntime.cancelNavigation(");
    expect(source).toContain(
      "swapContent: async function(html, targetPath, navigation, clientNavigation)",
    );
    expect(source).toContain("if (!isNavigationCurrent()) return false;");
    expect(source).toContain("reactRootContainer !== container");
    expect(source).toContain('document.getElementById("__farm_page__") || currentRoot');
    expect(source).toContain("Navigation itself signals intent");
    expect(source).toContain("pageShouldHydrate:");
    expect(source).toContain("page.pageShouldHydrate");
    expect(source).toContain("load: ${load}");
    expect(source).not.toContain("imports.push(`import Page${index}");
  });

  it("uses manifest fragments for dev navigation and leaves docs navigation isolated", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf-8");
    const routerSource = fs.readFileSync(
      path.join(process.cwd(), "src", "client", "spa-router.ts"),
      "utf-8",
    );

    expect(source).toContain("MANIFEST-DRIVEN HTML-FRAGMENT NAVIGATION");
    expect(source).toContain("pageData.fragment?.html");
    expect(source).toContain("replaceNavigationBoundary(");
    expect(source).toContain("activeLayoutPatterns");
    expect(source).not.toContain("async function moduleLooksClient(");
    expect(source).toContain(
      "if (document.documentElement.dataset.farmDocsRuntime === 'true') return;",
    );
    expect(source).toContain(
      "async handlePopState(event) {\n    if (document.documentElement.dataset.farmDocsRuntime === 'true') return;",
    );
    expect(source).toContain("The scheduler owns queue draining and exactly-once click replay");
    expect(source).toContain("pendingPageHydrationController?.abort()");
    expect(routerSource).not.toContain("pageData.isClientComponent === false");
    expect(routerSource).toContain(
      'if (document.documentElement.dataset.farmDocsRuntime === "true") return;',
    );
  });
});
