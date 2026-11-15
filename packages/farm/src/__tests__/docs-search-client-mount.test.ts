// @vitest-environment jsdom

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateFarmDocsSearchClientRuntime,
  resolveFarmDocsSearchFrameworkModule,
} from "../docs/search-client";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();

afterEach(async () => {
  document.body.innerHTML = "";
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function writeFile(root: string, relativePath: string, source: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
  return filePath;
}

// A theme laid out like @farming-labs/theme: the search component reads its router from
// fumadocs-core's framework context, which throws outside `FrameworkProvider`.
async function createTheme() {
  // Inside the package, so the fake theme resolves this package's React.
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-docs-search-"));
  temporaryRoots.add(root);
  const themeRoot = path.join(root, "node_modules/@farming-labs/theme");
  await writeFile(
    themeRoot,
    "node_modules/fumadocs-core/package.json",
    JSON.stringify({
      name: "fumadocs-core",
      type: "module",
      exports: { "./framework": "./dist/framework/index.js" },
    }),
  );
  await writeFile(
    themeRoot,
    "node_modules/fumadocs-core/dist/framework/index.js",
    `import { createContext, createElement, useContext } from "react";
const notImplemented = () => {
  throw new Error("You need to wrap your application inside \`FrameworkProvider\`.");
};
const FrameworkContext = createContext({ useRouter: notImplemented });
export function FrameworkProvider({ children, ...framework }) {
  return createElement(FrameworkContext.Provider, { value: framework }, children);
}
export function useRouter() {
  return useContext(FrameworkContext).useRouter();
}`,
  );
  const searchModule = await writeFile(
    themeRoot,
    "dist/docs-command-search.mjs",
    `import { createElement } from "react";
import { useRouter } from "fumadocs-core/framework";
export function DocsCommandSearch({ api }) {
  const router = useRouter();
  return createElement("output", { "data-router": typeof router.push }, api);
}`,
  );
  return searchModule;
}

describe("Farm docs search mount", () => {
  it("renders the theme search inside the theme's framework provider", async () => {
    const searchModule = await createTheme();
    const frameworkModule = resolveFarmDocsSearchFrameworkModule(searchModule);
    expect(frameworkModule).toMatch(/fumadocs-core[\\/]dist[\\/]framework[\\/]index\.js$/);

    const runtimePath = await writeFile(
      path.dirname(searchModule),
      "runtime.mjs",
      `import React from "react";
import { createRoot } from "react-dom/client";
${generateFarmDocsSearchClientRuntime(
  true,
  // Node imports a Windows path only as a file URL; Vite and the bundler resolve both.
  pathToFileURL(searchModule).href,
  pathToFileURL(frameworkModule!).href,
)}
export { mountFarmDocsSearch };`,
    );
    document.body.innerHTML = '<div data-farm-docs-search-root data-api="/api/docs"></div>';
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", onError);

    const { mountFarmDocsSearch } = await import(
      /* @vite-ignore */ pathToFileURL(runtimePath).href
    );
    expect(await mountFarmDocsSearch()).toBe(true);
    await expect
      .poll(() => document.querySelector("output")?.getAttribute("data-router"))
      .toBe("function");
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
  });
});
