import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompiledComponent } from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const roots = new Set<Root>();

async function flushCompilerUpdates() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});

describe("compiled static binding runtime", () => {
  it("patches numeric, unitless, custom, and removed style values without rerendering", async () => {
    let renders = 0;
    const StyledPanel = createCompiledComponent({
      displayName: "StyledPanel",
      initialize: () => [0],
      render(_props: Record<string, never>, state) {
        renders += 1;
        const phase = Number(state[0].get());
        return (
          <button
            onClick={() => state[0].set((value) => Number(value) + 1)}
            style={{
              opacity: phase === 0 ? 1 : 0.55,
              width: phase === 0 ? 12 : 24,
              "--progress": phase === 2 ? null : `${phase * 50}%`,
            }}
          >
            Advance
          </button>
        );
      },
      bindings: [
        {
          kind: "style",
          path: [],
          dependencies: [0],
          name: "opacity",
          read: (_props, state) => (Number(state[0].get()) === 0 ? 1 : 0.55),
        },
        {
          kind: "style",
          path: [],
          dependencies: [0],
          name: "width",
          read: (_props, state) => (Number(state[0].get()) === 0 ? 12 : 24),
        },
        {
          kind: "style",
          path: [],
          dependencies: [0],
          name: "--progress",
          read: (_props, state) =>
            Number(state[0].get()) === 2 ? null : `${Number(state[0].get()) * 50}%`,
        },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<StyledPanel />));
    const button = container.querySelector("button")!;

    expect(button.style.width).toBe("12px");
    expect(button.style.opacity).toBe("1");
    expect(button.style.getPropertyValue("--progress")).toBe("0%");
    const initialRenders = renders;

    await act(async () => {
      button.click();
      await flushCompilerUpdates();
    });
    expect(button.style.width).toBe("24px");
    expect(button.style.opacity).toBe("0.55");
    expect(button.style.getPropertyValue("--progress")).toBe("50%");

    await act(async () => {
      button.click();
      await flushCompilerUpdates();
    });
    expect(button.style.getPropertyValue("--progress")).toBe("");
    expect(renders).toBe(initialRenders);
  });

  it("keeps textarea, select, checkbox, and text bindings coherent without rerendering", async () => {
    let renders = 0;
    const FormBindings = createCompiledComponent({
      displayName: "FormBindings",
      initialize: () => ["Farm", "balanced", true],
      render(_props: Record<string, never>, state) {
        renders += 1;
        return (
          <form>
            <textarea
              onInput={(event) => state[0].set(event.currentTarget.value)}
              value={String(state[0].get())}
            />
            <select
              onChange={(event) => state[1].set(event.currentTarget.value)}
              value={String(state[1].get())}
            >
              <option value="balanced">Balanced</option>
              <option value="fast">Fast</option>
            </select>
            <input
              checked={Boolean(state[2].get())}
              onChange={(event) => state[2].set(event.currentTarget.checked)}
              type="checkbox"
            />
            <output>
              {String(state[0].get())}:{String(state[1].get())}:{state[2].get() ? "on" : "off"}
            </output>
          </form>
        );
      },
      bindings: [
        {
          kind: "attribute",
          path: [0],
          dependencies: [0],
          name: "value",
          read: (_props, state) => state[0].get(),
        },
        {
          kind: "attribute",
          path: [1],
          dependencies: [1],
          name: "value",
          read: (_props, state) => state[1].get(),
        },
        {
          kind: "attribute",
          path: [2],
          dependencies: [2],
          name: "checked",
          read: (_props, state) => state[2].get(),
        },
        {
          kind: "text",
          path: [3],
          dependencies: [0, 1, 2],
          read: (_props, state) => [
            state[0].get(),
            ":",
            state[1].get(),
            ":",
            state[2].get() ? "on" : "off",
          ],
        },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<FormBindings />));
    const textarea = container.querySelector("textarea")!;
    const select = container.querySelector("select")!;
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const initialRenders = renders;

    await act(async () => {
      textarea.focus();
      textarea.value = "FaXrm";
      textarea.setSelectionRange(3, 3);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: "X" }));
      textarea.value = "Farm";
      await flushCompilerUpdates();
    });
    expect(textarea.value).toBe("FaXrm");
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);

    await act(async () => {
      select.value = "fast";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      checkbox.click();
      await flushCompilerUpdates();
    });

    expect(select.value).toBe("fast");
    expect(checkbox.checked).toBe(false);
    expect(container.querySelector("output")?.textContent).toBe("FaXrm:fast:off");
    expect(renders).toBe(initialRenders);
  });

  it("updates every selected option for a controlled multiple select", async () => {
    const MultiSelect = createCompiledComponent({
      displayName: "MultiSelect",
      initialize: () => [["one"]],
      render(_props: Record<string, never>, state) {
        return (
          <section>
            <select multiple value={state[0].get() as string[]} onChange={() => {}}>
              <option value="one">One</option>
              <option value="two">Two</option>
              <option value="three">Three</option>
            </select>
            <button onClick={() => state[0].set(["two", "three"])}>Change</button>
          </section>
        );
      },
      bindings: [
        {
          kind: "attribute",
          path: [0],
          dependencies: [0],
          name: "value",
          read: (_props, state) => state[0].get(),
        },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<MultiSelect />));

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });

    expect(
      [...container.querySelectorAll("option")]
        .filter((option) => option.selected)
        .map((option) => option.value),
    ).toEqual(["two", "three"]);
  });
});
