import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { FarmDocsResolvedConfig } from "./types";

export function isFarmDocsSearchEnabled(docs: FarmDocsResolvedConfig | undefined): boolean {
  if (!docs?.enabled) return false;

  const search = docs.config.search;
  if (search === false) return false;
  return !(search && typeof search === "object" && search.enabled === false);
}

export function resolveFarmDocsSearchClientModule(root: string): string {
  try {
    const requireFromApp = createRequire(path.join(path.resolve(root), "package.json"));
    const themeEntry = requireFromApp.resolve("@farming-labs/theme");
    const commandSearchModule = path.join(path.dirname(themeEntry), "docs-command-search.mjs");
    if (existsSync(commandSearchModule)) return commandSearchModule;
  } catch {
    // The public package entry remains a compatible fallback.
  }

  return "@farming-labs/theme";
}

export function generateFarmDocsSearchClientRuntime(
  enabled: boolean,
  moduleId = "@farming-labs/theme",
): string {
  if (!enabled) {
    return `
function isFarmDocsSearchPage() {
  return false;
}

async function mountFarmDocsSearch() {
  return false;
}
`;
  }

  return `
let farmDocsSearchRoot = null;
let farmDocsSearchContainer = null;
let farmDocsSearchModulePromise = null;

function isFarmDocsSearchPage() {
  return document.querySelector('[data-farm-docs-search-root]') instanceof HTMLElement;
}

async function mountFarmDocsSearch() {
  const container = document.querySelector('[data-farm-docs-search-root]');
  if (!(container instanceof HTMLElement)) return false;
  if (farmDocsSearchContainer === container && farmDocsSearchRoot) return true;

  try {
    farmDocsSearchModulePromise ||= import(${JSON.stringify(moduleId)});
    const { DocsCommandSearch } = await farmDocsSearchModulePromise;
    if (!container.isConnected) return false;

    if (farmDocsSearchRoot) {
      try {
        farmDocsSearchRoot.unmount();
      } catch {}
    }

    farmDocsSearchContainer = container;
    farmDocsSearchRoot = createRoot(container);
    farmDocsSearchRoot.render(
      React.createElement(DocsCommandSearch, {
        api: container.dataset.api || '/api/docs',
      }),
    );
    return true;
  } catch (error) {
    farmDocsSearchModulePromise = null;
    console.error('[Farm.js] Could not load docs search:', error);
    return false;
  }
}

window.__FARM_MOUNT_DOCS_SEARCH__ = mountFarmDocsSearch;
`;
}
