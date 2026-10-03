import type { FarmRendererRouteState } from "@farm.js/core/renderer";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import * as clientRuntime from "../client";

function StatefulLayout(props: { children?: unknown; params?: Record<string, string> }) {
  const [count, setCount] = createSignal(0);
  return (
    <section>
      <button data-layout-count onClick={() => setCount((value) => value + 1)}>
        count: {count()}
      </button>
      <output data-layout-param>{props.params?.slug}</output>
      <main>{props.children}</main>
    </section>
  );
}

function createRouteState(label: string, slug: string): FarmRendererRouteState {
  const page = clientRuntime.createElement("p", { "data-page": label }, label);
  const params = { slug };
  return {
    element: clientRuntime.createElement(StatefulLayout, { children: page, params }),
    layouts: [{ pattern: "/", Component: StatefulLayout }],
    page,
    params,
  };
}

describe("Solid renderer-owned route updates", () => {
  it("updates the route slot and params without remounting shared layouts", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = clientRuntime.createRoot(container);

    root.renderRoute(createRouteState("first page", "first"));
    await Promise.resolve();

    const button = container.querySelector<HTMLButtonElement>("[data-layout-count]");
    expect(button).toBeTruthy();
    button!.click();
    expect(button!.textContent).toContain("count: 1");

    root.renderRoute(createRouteState("second page", "second"));
    await Promise.resolve();

    expect(container.querySelector("[data-layout-count]")).toBe(button);
    expect(button!.textContent).toContain("count: 1");
    expect(container.querySelector("[data-layout-param]")?.textContent).toBe("second");
    expect(container.querySelector("[data-page]")?.textContent).toBe("second page");

    root.unmount();
    container.remove();
  });
});
