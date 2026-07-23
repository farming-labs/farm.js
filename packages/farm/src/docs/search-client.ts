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

export function resolveFarmDocsSearchClientModule(root: string): string | undefined {
  try {
    const requireFromApp = createRequire(path.join(path.resolve(root), "package.json"));
    const themeEntry = requireFromApp.resolve("@farming-labs/theme");
    const commandSearchModule = path.join(path.dirname(themeEntry), "docs-command-search.mjs");
    if (existsSync(commandSearchModule)) return commandSearchModule;
  } catch {
    // The public package entry remains a compatible fallback.
  }

  return undefined;
}

export function generateFarmDocsSearchBootstrapRuntime(): string {
  return `(()=>{if(window.__farmDocsSearchBootstrap)return;window.__farmDocsSearchBootstrap=true;const queue=(trigger,event)=>{if(window.__FARM_DOCS_SEARCH_BRIDGE_ACTIVE__)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();window.__FARM_DOCS_SEARCH_PENDING__=trigger;window.__FARM_MOUNT_DOCS_SEARCH__?.()};document.addEventListener("click",(event)=>{const target=event.target instanceof Element?event.target.closest("[data-search-full]"):null;if(target)queue("button",event)},true);document.addEventListener("keydown",(event)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k")queue("keyboard",event)},true)})();`;
}

export function generateFarmDocsSearchClientRuntime(enabled: boolean, moduleId?: string): string {
  if (!enabled || !moduleId) {
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
let farmDocsSearchPendingTrigger = window.__FARM_DOCS_SEARCH_PENDING__ === 'keyboard'
  ? 'keyboard'
  : window.__FARM_DOCS_SEARCH_PENDING__
    ? 'button'
    : null;
let farmDocsSearchReady = false;

function isFarmDocsSearchPage() {
  return document.querySelector('[data-farm-docs-search-root]') instanceof HTMLElement;
}

function replayFarmDocsSearchOpen() {
  const pendingTrigger = farmDocsSearchPendingTrigger;
  farmDocsSearchPendingTrigger = null;
  window.__FARM_DOCS_SEARCH_PENDING__ = null;
  if (!pendingTrigger) return;

  queueMicrotask(() => {
    if (pendingTrigger === 'keyboard') {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'k',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    } else {
      const trigger = document.querySelector('[data-search-full]');
      if (trigger instanceof HTMLElement) trigger.click();
    }
  });
}

function FarmDocsSearchBridge({ component, api }) {
  React.useEffect(() => {
    farmDocsSearchReady = true;
    replayFarmDocsSearchOpen();
    return () => {
      farmDocsSearchReady = false;
    };
  }, []);

  return React.createElement(component, { api });
}

function queueFarmDocsSearchOpen(trigger, event) {
  if (farmDocsSearchReady) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  farmDocsSearchPendingTrigger = trigger;
  window.__FARM_DOCS_SEARCH_PENDING__ = trigger;
  void mountFarmDocsSearch();
}

document.addEventListener(
  'click',
  (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-search-full]')
      : null;
    if (target) queueFarmDocsSearchOpen('button', event);
  },
  true,
);

document.addEventListener(
  'keydown',
  (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      queueFarmDocsSearchOpen('keyboard', event);
    }
  },
  true,
);

window.__FARM_DOCS_SEARCH_BRIDGE_ACTIVE__ = true;

async function mountFarmDocsSearch() {
  const container = document.querySelector('[data-farm-docs-search-root]');
  if (!(container instanceof HTMLElement)) return false;
  if (farmDocsSearchContainer === container && farmDocsSearchRoot) return true;

  try {
    farmDocsSearchModulePromise ||= import(${JSON.stringify(moduleId)});
    const { DocsCommandSearch } = await farmDocsSearchModulePromise;
    if (!container.isConnected) return false;

    if (farmDocsSearchRoot) {
      farmDocsSearchReady = false;
      try {
        farmDocsSearchRoot.unmount();
      } catch {}
    }

    farmDocsSearchContainer = container;
    farmDocsSearchRoot = createRoot(container);
    farmDocsSearchRoot.render(
      React.createElement(FarmDocsSearchBridge, {
        component: DocsCommandSearch,
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
