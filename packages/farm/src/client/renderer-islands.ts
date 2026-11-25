/**
 * @internal The browser side of islands for a renderer that declares `capabilities.islands`
 * (RFC 0012). islx's runtime finds, schedules and decodes the islands; each one hydrates through
 * the renderer client module's `createElement` and `hydrateRoot`, so the renderer writes no
 * browser code for islands. This gives it the shape Farm's client entries call: hydrate and
 * dispose by scope, as a navigation swaps part of the page.
 */
import { createIslandRuntime, defineIslandRenderer } from "@farm.js/islx/islands/client";
import type { FarmRendererClientRoot } from "../renderer";
import type { scheduleFarmIslandHydration } from "./island-runtime";

export interface FarmRendererIslandRuntimeOptions {
  /** The renderer's client module. */
  renderer: {
    createElement(type: unknown, props?: unknown): unknown;
    hydrateRoot(container: Element, element: unknown): FarmRendererClientRoot;
  };
  /** Imports an island's module by the reference `<f-island src>` carries. */
  load(reference: string): Promise<Record<string, unknown>>;
  schedule: typeof scheduleFarmIslandHydration;
}

export interface FarmRendererIslandRuntime {
  /** Starts the islands under `scope` that aren't started yet. */
  hydrate(scope?: ParentNode, signal?: AbortSignal): Promise<void>;
  /** Unmounts the islands under `scope`, and drops the ones there still waiting to start. */
  dispose(scope?: ParentNode): void;
  /**
   * Unmounts the islands whose markup is gone. A root that re-renders the page around them, such
   * as a hydrating layout on navigation, replaces their markup without telling the runtime.
   */
  prune(): void;
  /** Islands mode carries islands over a refresh; these islands start again instead. */
  carryOver(): void;
  rootCount(): number;
  /**
   * After a development hot update of the module `reference` (an `<f-island src>`), renders its
   * started islands again with `module`'s exports, and starts its later islands with `module`.
   * Returns false, changing nothing, when an island can't take the update in place: one still
   * waiting to start, whose server HTML the old code rendered, or an export the module no longer
   * has. The caller reloads the page then.
   */
  updateModule(reference: string, module: Record<string, unknown>): boolean;
}

export function createFarmRendererIslandRuntime(
  options: FarmRendererIslandRuntimeOptions,
): FarmRendererIslandRuntime {
  const roots = new Map<Element, StartedIsland>();
  // The modules hot updates replaced. The browser keeps the first copy of a module under its
  // plain URL, which load() imports, so an island that starts after an update needs this one.
  const replaced = new Map<string, Record<string, unknown>>();
  const report = (message: string, error?: unknown) => console.error(`[Farm.js] ${message}`, error);
  const islands = createIslandRuntime({
    renderer: defineIslandRenderer({
      hydrate(container, component, props, island) {
        const root = options.renderer.hydrateRoot(
          container,
          options.renderer.createElement(component, props),
        );
        roots.set(container, { root, src: island.src, export: island.export, props });
        return {
          unmount() {
            roots.delete(container);
            root.unmount();
          },
        };
      },
    }),
    load: (reference) => {
      const module = replaced.get(reference);
      return module ? Promise.resolve(module) : options.load(reference);
    },
    schedule: options.schedule,
    report,
  });

  return {
    async hydrate(scope = document, signal) {
      // A superseded navigation's islands are disposed with the part of the page it replaces.
      if (signal?.aborted) return;
      await islands.hydrate(scope);
    },
    dispose(scope = document) {
      islands.dispose(scope);
    },
    prune() {
      for (const container of Array.from(roots.keys())) {
        if (!container.isConnected) islands.dispose(container);
      }
    },
    carryOver() {},
    rootCount: () => roots.size,
    updateModule(reference, module) {
      for (const container of document.querySelectorAll(ISLAND_SELECTOR)) {
        // An island inside another is rendered by that island's root.
        if (container.getAttribute("src") !== reference || roots.has(container)) continue;
        if (!container.parentElement?.closest(ISLAND_SELECTOR)) return false;
      }
      const started = Array.from(roots)
        .filter(([container, island]) => island.src === reference && container.isConnected)
        .map(([, island]) => island);
      if (started.some((island) => !isComponent(module[island.export]))) return false;

      replaced.set(reference, module);
      try {
        for (const island of started) {
          island.root.render(options.renderer.createElement(module[island.export], island.props));
        }
      } catch (error) {
        report(`Could not update the islands of ${reference} in place.`, error);
        return false;
      }
      return true;
    },
  };
}

interface StartedIsland {
  root: FarmRendererClientRoot;
  src: string;
  export: string;
  props: Record<string, unknown>;
}

const ISLAND_SELECTOR = "f-island";

// What islx's runtime accepts as an island's component.
function isComponent(value: unknown): boolean {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}
