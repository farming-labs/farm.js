// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createElement, createRoot, hydrateRoot } from "../client";
import { renderToString } from "../server";

describe("Svelte client renderer", () => {
  it("mounts, updates, and unmounts a managed root", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    root.render(createElement("p", null, "First"));
    expect(container.textContent).toBe("First");

    root.render(createElement("p", null, "Second"));
    expect(container.textContent).toBe("Second");

    root.unmount();
    expect(container.childNodes).toHaveLength(0);
  });

  it("hydrates server-rendered markup", async () => {
    const element = createElement("button", null, "Continue");
    const container = document.createElement("div");
    container.innerHTML = await renderToString(element);
    const button = container.querySelector("button");

    const root = hydrateRoot(container, element);
    expect(container.querySelector("button")).toBe(button);
    root.unmount();
  });
});
