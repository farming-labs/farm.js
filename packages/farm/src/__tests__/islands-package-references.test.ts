import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  farmPackageClientImportExports,
  farmPackageClientReferencePath,
  findFarmPackageClientImports,
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
      '"use client";\nexport { ThemeProvider } from "next-themes";',
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
