// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createElement, createRoot, hydrateRoot } from "../client";

describe("Vue client renderer", () => {
  it("mounts, updates, and unmounts a managed root", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    root.render(createElement("p", null, "First"));
    expect(container.textContent).toBe("First");

    root.render(createElement("p", null, "Second"));
    await Promise.resolve();
    expect(container.textContent).toBe("Second");

    root.unmount();
    expect(container.childNodes).toHaveLength(0);
  });

  it("hydrates server-rendered markup", () => {
    const container = document.createElement("div");
    container.innerHTML = "<button>Continue</button>";
    const button = container.firstElementChild;

    const root = hydrateRoot(container, createElement("button", null, "Continue"));
    expect(container.firstElementChild).toBe(button);
    root.unmount();
  });
});
