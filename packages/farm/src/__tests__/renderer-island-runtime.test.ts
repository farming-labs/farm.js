// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmRendererIslandRuntime } from "../client/renderer-islands";

/**
 * The browser side of RFC 0012 islands, with a renderer whose elements are plain objects and whose
 * roots record what they render. The leaf example's e2e covers a real renderer and Vite's updates.
 */
interface Rendered {
  type: unknown;
  props: Record<string, unknown>;
}

function setup(modules: Record<string, Record<string, unknown>>) {
  const roots: { container: Element; rendered: Rendered[]; unmounted: boolean }[] = [];
  const load = vi.fn(async (reference: string) => modules[reference]!);
  const runtime = createFarmRendererIslandRuntime({
    renderer: {
      createElement: (type, props) => ({ type, props: props as Record<string, unknown> }),
      hydrateRoot(container, element) {
        const root = { container, rendered: [element as Rendered], unmounted: false };
        roots.push(root);
        return {
          render: (next: unknown) => root.rendered.push(next as Rendered),
          unmount: () => {
            root.unmounted = true;
          },
        };
      },
    },
    load,
    // Starts each island at once; the strategy under test is the module's.
    schedule: (async ({ strategy, hydrate }: { strategy: string; hydrate(): Promise<void> }) => {
      if (strategy !== "visible") await hydrate();
    }) as never,
  });
  return { runtime, roots, load };
}

let ids = 0;
function island(src: string, exportName: string, props: object, strategy = "load"): string {
  const id = `fi${ids++}`;
  return (
    `<f-island src="${src}" export="${exportName}" props="${id}" strategy="${strategy}" ` +
    `style="display:contents"><button>server</button></f-island>` +
    `<script type="f/props" for="${id}">${JSON.stringify(props)}</script>`
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("updateModule", () => {
  const Counter = () => null;
  const Badge = () => null;

  it("renders each started island of the module again with the new export and its props", async () => {
    const { runtime, roots } = setup({
      "/src/counter.leaf": { Counter },
      "/src/badge.leaf": { default: Badge },
    });
    document.body.innerHTML =
      island("/src/counter.leaf", "Counter", { crop: "wheat" }) +
      island("/src/counter.leaf", "Counter", { crop: "rye" }) +
      island("/src/badge.leaf", "default", {});
    await runtime.hydrate();
    expect(roots).toHaveLength(3);

    const NextCounter = () => null;
    expect(runtime.updateModule("/src/counter.leaf", { Counter: NextCounter })).toBe(true);
    expect(roots.map((root) => root.rendered.at(-1))).toEqual([
      { type: NextCounter, props: { crop: "wheat" } },
      { type: NextCounter, props: { crop: "rye" } },
      { type: Badge, props: {} },
    ]);
    expect(roots[2]!.rendered).toHaveLength(1);
  });

  it("starts an island that arrives after the update with the new module", async () => {
    const { runtime, roots, load } = setup({ "/src/counter.leaf": { Counter } });
    document.body.innerHTML = island("/src/counter.leaf", "Counter", { crop: "wheat" });
    await runtime.hydrate();

    const NextCounter = () => null;
    expect(runtime.updateModule("/src/counter.leaf", { Counter: NextCounter })).toBe(true);
    // A navigation brings another island of the module.
    const section = document.createElement("section");
    section.innerHTML = island("/src/counter.leaf", "Counter", { crop: "oat" });
    document.body.append(section);
    await runtime.hydrate(section);

    expect(roots[1]!.rendered[0]).toEqual({ type: NextCounter, props: { crop: "oat" } });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("changes nothing and returns false while an island of the module waits to start", async () => {
    const { runtime, roots } = setup({ "/src/counter.leaf": { Counter } });
    document.body.innerHTML =
      island("/src/counter.leaf", "Counter", { crop: "wheat" }) +
      island("/src/counter.leaf", "Counter", { crop: "rye" }, "visible");
    await runtime.hydrate();
    expect(roots).toHaveLength(1);

    expect(runtime.updateModule("/src/counter.leaf", { Counter: () => null })).toBe(false);
    expect(roots[0]!.rendered).toHaveLength(1);
  });

  it("changes nothing and returns false when the module lost a started island's export", async () => {
    const { runtime, roots } = setup({ "/src/counter.leaf": { Counter } });
    document.body.innerHTML = island("/src/counter.leaf", "Counter", { crop: "wheat" });
    await runtime.hydrate();

    expect(runtime.updateModule("/src/counter.leaf", { Planter: () => null })).toBe(false);
    expect(roots[0]!.rendered).toHaveLength(1);
  });

  it("returns true for a module with no islands on the page", async () => {
    const { runtime } = setup({});
    expect(runtime.updateModule("/src/counter.leaf", { Counter })).toBe(true);
  });

  it("reports a render that throws and returns false, so the page reloads", async () => {
    const { runtime, roots } = setup({ "/src/counter.leaf": { Counter } });
    document.body.innerHTML = island("/src/counter.leaf", "Counter", { crop: "wheat" });
    await runtime.hydrate();
    const error = new Error("render failed");
    const root = roots[0]!;
    root.rendered.push = () => {
      throw error;
    };
    const report = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(runtime.updateModule("/src/counter.leaf", { Counter: () => null })).toBe(false);
    expect(report).toHaveBeenCalledWith(
      "[Farm.js] Could not update the islands of /src/counter.leaf in place.",
      error,
    );
  });
});
