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
}

export function createFarmRendererIslandRuntime(
  options: FarmRendererIslandRuntimeOptions,
): FarmRendererIslandRuntime {
  const containers = new Set<Element>();
  const islands = createIslandRuntime({
    renderer: defineIslandRenderer({
      hydrate(container, component, props) {
        const root = options.renderer.hydrateRoot(
          container,
          options.renderer.createElement(component, props),
        );
        containers.add(container);
        return {
          unmount() {
            containers.delete(container);
            root.unmount();
          },
        };
      },
    }),
    load: options.load,
    schedule: options.schedule,
    report: (message, error) => console.error(`[Farm.js] ${message}`, error),
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
      for (const container of Array.from(containers)) {
        if (!container.isConnected) islands.dispose(container);
      }
    },
    carryOver() {},
    rootCount: () => containers.size,
  };
}
