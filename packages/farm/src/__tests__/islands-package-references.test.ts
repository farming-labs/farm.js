import fs, { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  farmPackageClientImportExports,
  farmPackageClientReferencePath,
  findFarmPackageClientImports,
  parseFarmResolveFrom,
  rewriteFarmPackageClientImports,
} from "../islands-package-references";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "farm-package-references-"));
  roots.push(root);
  return root;
}
const clientPackages = new Set(["next-themes", "@radix-ui/react-dialog", "sonner"]);
const isClientPackage = (specifier: string) => clientPackages.has(specifier);

describe("package client references", () => {
  it("finds named, default and namespace imports, and the namespace members a module reads", () => {
    const imports = findFarmPackageClientImports(
      [
        'import Toast, { Toaster as Tray } from "sonner";',
        'import * as Dialog from "@radix-ui/react-dialog";',
        'import type { ThemeProviderProps } from "next-themes";',
        'import { useState } from "react";',
        "export default () => <Dialog.Root><Dialog.Trigger /><Tray /><Toast /></Dialog.Root>;",
      ].join("\n"),
      "/app/src/page.tsx",
      isClientPackage,
    );
    expect(
      imports.map((entry) => [entry.specifier, farmPackageClientImportExports(entry)]),
    ).toEqual([
      ["sonner", ["default", "Toaster"]],
      ["@radix-ui/react-dialog", ["Root", "Trigger"]],
    ]);
  });

  it("leaves a namespace the module passes around as a value", () => {
    expect(
      findFarmPackageClientImports(
        'import * as Dialog from "@radix-ui/react-dialog";\nexport const parts = Dialog;\n',
        "/app/src/page.tsx",
        isClientPackage,
      ),
    ).toEqual([]);
  });

  it("makes a namespace passed around as a value stand for every export of the package, with client references for its components", () => {
    const root = tempRoot();
    const files: Record<string, string> = {
      "node_modules/ui-parts/package.json": JSON.stringify({
        name: "ui-parts",
        exports: { ".": { import: "./index.js" } },
      }),
      "node_modules/ui-parts/index.js":
        '"use client";\nexport * from "./root.js";\nexport { Trigger } from "./trigger.js";\n',
      "node_modules/ui-parts/root.js": "export function Root() {}\nexport const version = 1;\n",
      "node_modules/ui-parts/trigger.js": "export function Trigger() {}\n",
    };
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
    const imports = findFarmPackageClientImports(
      'import * as Parts from "ui-parts";\nexport const parts = Parts;\n',
      path.join(root, "src/page.tsx"),
      (specifier) => specifier === "ui-parts",
    );
    // `version` is not a component, so it comes from the package itself rather than a reference.
    expect(imports.map(farmPackageClientImportExports)).toEqual([["Root", "Trigger"]]);
    const output = rewriteFarmPackageClientImports({
      code: 'import * as Parts from "ui-parts";\nexport const parts = Parts;\n',
      file: path.join(root, "src/page.tsx"),
      root,
      isClientPackage: (specifier) => specifier === "ui-parts",
    })!;
    expect(output).toContain('import * as __farm_package_values_2__ from "ui-parts";');
    expect(output).toContain("version: __farm_package_values_2__.version");
    expect(output).toContain("Root: __farm_package_reference_0__");
  });

  it("keeps exports the package defines outside use client modules as plain imports", () => {
    // Shaped like @tanstack/react-query: client components imported then re-exported by name, and
    // server-safe functions from another package through `export *`.
    const root = tempRoot();
    const files: Record<string, string> = {
      "node_modules/rq/package.json": JSON.stringify({
        name: "rq",
        exports: { ".": { import: "./index.js" } },
      }),
      "node_modules/rq/index.js":
        'import { HydrationBoundary } from "./boundary.js";\nexport * from "rq-core";\nexport { HydrationBoundary };\n',
      "node_modules/rq/boundary.js": '"use client";\nexport function HydrationBoundary() {}\n',
      "node_modules/rq-core/package.json": JSON.stringify({
        name: "rq-core",
        exports: { ".": { import: "./index.js" } },
      }),
      "node_modules/rq-core/index.js":
        'import { dehydrate } from "./hydration.js";\nexport class QueryClient {}\nexport { dehydrate };\n',
      "node_modules/rq-core/hydration.js": "export function dehydrate() {}\n",
    };
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
    const page = path.join(root, "src/page.tsx");
    const code = 'import { dehydrate, HydrationBoundary, QueryClient } from "rq";\n';
    const [entry] = findFarmPackageClientImports(code, page, (specifier) => specifier === "rq");
    expect(farmPackageClientImportExports(entry!)).toEqual(["HydrationBoundary"]);
    const output = rewriteFarmPackageClientImports({
      code,
      file: page,
      root,
      isClientPackage: (specifier) => specifier === "rq",
    })!;
    expect(output).toContain(
      'import { dehydrate as dehydrate, QueryClient as QueryClient } from "rq";',
    );
    expect(output).toContain(
      `import { HydrationBoundary as HydrationBoundary } from ${JSON.stringify(farmPackageClientReferencePath(root, "rq", "HydrationBoundary"))};`,
    );
    // Server exports only: the import stays as it is.
    expect(
      rewriteFarmPackageClientImports({
        code: 'import { QueryClient } from "rq";\n',
        file: page,
        root,
        isClientPackage: (specifier) => specifier === "rq",
      }),
    ).toBeNull();
  });

  it("points the imports at client references that re-export each one with use client", () => {
    const root = tempRoot();
    const code = [
      'import { ThemeProvider } from "next-themes";',
      'import * as Dialog from "@radix-ui/react-dialog";',
      "export default () => <ThemeProvider><Dialog.Root /></ThemeProvider>;",
    ].join("\n");
    const output = rewriteFarmPackageClientImports({
      code,
      file: path.join(root, "src/page.tsx"),
      root,
      isClientPackage,
    })!;
    const theme = farmPackageClientReferencePath(root, "next-themes", "ThemeProvider");
    const dialogRoot = farmPackageClientReferencePath(root, "@radix-ui/react-dialog", "Root");
    expect(theme).toBe(path.join(root, ".farm/client-references/next-themes/ThemeProvider.tsx"));
    expect(dialogRoot).toBe(
      path.join(root, ".farm/client-references/radix-ui+react-dialog/Root.tsx"),
    );
    expect(output).toContain(
      `import { ThemeProvider as ThemeProvider } from ${JSON.stringify(theme)};`,
    );
    expect(output).toContain(`from ${JSON.stringify(dialogRoot)};`);
    expect(output).toMatch(
      /const Dialog = Object\.freeze\(\{ Root: __farm_package_reference_0__ \}\);/,
    );
    expect(output).not.toContain('from "next-themes"');
    expect(readFileSync(theme, "utf8")).toContain(
      '"use client";\nimport { ThemeProvider as __farm_reference__ } from "next-themes";\nexport { __farm_reference__ as ThemeProvider };',
    );

    // Writing again leaves an unchanged reference alone, so a watcher sees no change.
    const written = statSync(theme).mtimeMs;
    rewriteFarmPackageClientImports({
      code,
      file: path.join(root, "src/page.tsx"),
      root,
      isClientPackage,
    });
    expect(statSync(theme).mtimeMs).toBe(written);
  });

  it("resolves a package from the importer's side when the app root has another copy or none", () => {
    // A pnpm monorepo: packages/ui depends on sonner, the app does not.
    const workspace = tempRoot();
    const root = path.join(workspace, "apps/web");
    const ui = path.join(workspace, "packages/ui");
    const writePackage = (directory: string) => {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "package.json"), '{"name":"sonner"}');
    };
    writePackage(path.join(ui, "node_modules/sonner"));
    fs.mkdirSync(root, { recursive: true });
    const code = 'import { Toaster } from "sonner";\nexport default () => <Toaster />;\n';
    const rewrite = (file: string) =>
      rewriteFarmPackageClientImports({ code, file, root, isClientPackage })!;

    const output = rewrite(path.join(ui, "src/toaster.tsx"));
    const reference = /from ("[^"]+Toaster\.tsx")/.exec(output)![1]!;
    const file = JSON.parse(reference) as string;
    expect(path.relative(root, file)).toMatch(
      /^\.farm[\\/]client-references[\\/]sonner[\\/]__from__[0-9a-f]{8}[\\/]Toaster\.tsx$/,
    );
    const target = /from "(farm:resolve-from:[^"]+)"/.exec(readFileSync(file, "utf8"))![1]!;
    const resolved = parseFarmResolveFrom(target, file)!;
    expect(resolved.specifier).toBe("sonner");
    expect(path.dirname(resolved.importer)).toBe(fs.realpathSync(ui));

    // The app's own copy of another version: the importer still gets its own.
    writePackage(path.join(root, "node_modules/sonner"));
    expect(rewrite(path.join(ui, "src/toaster.tsx"))).toContain(reference);

    // The same copy from both sides: the plain reference, which imports the package by name.
    const plain = rewrite(path.join(root, "src/page.tsx"));
    expect(plain).toContain(
      JSON.stringify(farmPackageClientReferencePath(root, "sonner", "Toaster")),
    );
    expect(
      readFileSync(farmPackageClientReferencePath(root, "sonner", "Toaster"), "utf8"),
    ).toContain('from "sonner";');
  });

  it("reads only farm:resolve-from imports", () => {
    expect(parseFarmResolveFrom("sonner", "/app/.farm/client-references/sonner/x.tsx")).toBeNull();
    expect(parseFarmResolveFrom("farm:resolve-from:", "/app/x.tsx")).toBeNull();
  });

  it("returns null for a module without package client imports", () => {
    expect(
      rewriteFarmPackageClientImports({
        code: 'import { useState } from "react";\nexport const x = 1;\n',
        file: "/app/src/x.ts",
        root: tempRoot(),
        isClientPackage,
      }),
    ).toBeNull();
  });
});
