import { setFarmBasePath } from "@farm.js/core/internal/client-runtime";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { Link } from "../bindings";

afterEach(() => {
  setFarmBasePath("/");
  document.body.replaceChildren();
});

describe("Solid Link in the browser", () => {
  it("updates its anchor when its props change", () => {
    const [name, setName] = createSignal("wheat");
    const [replace, setReplace] = createSignal(false);
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(
      () => (
        <Link href="/crops/[name]" params={{ name: name() }} replace={replace()} id="crop">
          {name()}
        </Link>
      ),
      container,
    );

    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("/crops/wheat");
    expect(anchor.hasAttribute("data-farm-link")).toBe(true);
    expect(anchor.hasAttribute("data-replace")).toBe(false);
    expect(anchor.id).toBe("crop");

    setName("barley");
    setReplace(true);
    expect(container.querySelector("a")).toBe(anchor);
    expect(anchor.getAttribute("href")).toBe("/crops/barley");
    expect(anchor.hasAttribute("data-replace")).toBe(true);
    expect(anchor.textContent).toBe("barley");
    dispose();
  });
});
