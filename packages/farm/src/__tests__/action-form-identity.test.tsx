/** @vitest-environment jsdom */
import { act, createElement, StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServerFn } from "../server-fn";
import { useAction, type UseActionReturn } from "../server-fn-client";

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each([false, true])(
  "preserves form identity, input, focus and selection (strict: %s)",
  async (strict) => {
    const target = createServerFn({ handler: async () => "saved" });
    let action!: UseActionReturn<unknown, string>;
    function View({ tick }: { tick: number }) {
      action = useAction(target, { optimistic: () => "pending", resetOnSubmit: tick === 0 });
      return createElement(
        action.Form,
        { id: `form-${tick}` },
        createElement("input", { name: "title", defaultValue: "initial" }),
      );
    }
    const render = (tick: number) => {
      const view = createElement(View, { tick });
      root.render(strict ? createElement(StrictMode, null, view) : view);
    };
    await act(async () => render(0));
    const Form = action.Form;
    const form = container.querySelector("form")!;
    const input = container.querySelector("input")!;
    input.value = "unsaved user input";
    input.focus();
    input.setSelectionRange(2, 7);
    await act(async () => render(1));
    expect(action.Form).toBe(Form);
    expect(container.querySelector("form")).toBe(form);
    expect(form.id).toBe("form-1");
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("unsaved user input");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
  },
);

it.each(["native", "imperative"])(
  "submits the latest target and options without replacing the mounted form (%s)",
  async (mode) => {
    let release!: (value: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const oldHandler = vi.fn(async () => "old");
    const newHandler = vi.fn(async (_context: { formData?: FormData }) => gate);
    const targets = [
      createServerFn({ handler: oldHandler }),
      createServerFn({ handler: newHandler }),
    ];
    const callbacks = [vi.fn(), vi.fn()];
    let action!: UseActionReturn<unknown, string>;
    function View({ index }: { index: number }) {
      action = useAction(
        { action: targets[index] },
        {
          optimistic: () => `pending-${index}`,
          onSuccess: callbacks[index],
        },
      );
      return useMemo(
        () =>
          createElement(
            action.Form,
            { "aria-label": "Save" },
            createElement("input", { name: "title", defaultValue: "initial" }),
            createElement("button", { type: "submit" }, "Save"),
          ),
        [action.Form],
      );
    }
    await act(async () => root.render(createElement(View, { index: 0 })));
    const form = container.querySelector("form")!;
    const input = container.querySelector("input")!;
    input.value = "draft";
    await act(async () => root.render(createElement(View, { index: 1 })));
    let submission: Promise<void> | undefined;
    await act(async () => {
      if (mode === "native") container.querySelector("form")!.requestSubmit();
      else submission = action.formAction(new FormData(container.querySelector("form")!));
    });
    try {
      expect(oldHandler).not.toHaveBeenCalled();
      expect(newHandler).toHaveBeenCalledOnce();
      expect(newHandler.mock.calls[0]?.[0]?.formData?.get("title")).toBe("draft");
      if (mode === "imperative") {
        expect(action.pending).toBe(true);
        expect(action.result).toBe("pending-1");
      }
      expect(container.querySelector("form")).toBe(form);
      expect(container.querySelector("input")).toBe(input);
    } finally {
      await act(async () => {
        release("saved");
        await gate;
        await submission;
      });
    }
    expect(action.result).toBe("saved");
    expect(callbacks[0]).not.toHaveBeenCalled();
    expect(callbacks[1]).toHaveBeenCalledWith("saved");
    expect(container.querySelector("input")).toBe(input);
    // React's successful function-action reset is preserved, not a remount.
    expect(input.value).toBe(mode === "native" ? "initial" : "draft");
  },
);
