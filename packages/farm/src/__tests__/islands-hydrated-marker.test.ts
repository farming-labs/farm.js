/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { hookEventName } from "@farm.js/islx/client";
import { createFarmIsolatedHydrationRuntime } from "../client/islands-runtime";

describe("the islands-mode hydrated marker", () => {
  it("marks an island as isolated hydration does, and clears it on failure and disposal", () => {
    const runtime = createFarmIsolatedHydrationRuntime({
      load: async () => ({}),
      schedule: async () => {},
    });
    const section = document.createElement("section");
    const island = document.createElement("f-island");
    island.setAttribute("src", "/counter.tsx");
    section.append(island);
    document.body.append(section);

    const emit = (name: string) =>
      document.dispatchEvent(new CustomEvent(hookEventName(name), { detail: { element: island } }));

    emit("hydrate");
    expect(island.getAttribute("data-farm-hydrated")).toBe("true");
    emit("islandError");
    expect(island.hasAttribute("data-farm-hydrated")).toBe(false);

    emit("hydrate");
    runtime.dispose(section);
    expect(island.hasAttribute("data-farm-hydrated")).toBe(false);

    emit("hydrate");
    runtime.dispose(island);
    expect(island.hasAttribute("data-farm-hydrated")).toBe(false);
    section.remove();
  });
});
