import React, { act, Activity, StrictMode, Suspense } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

afterAll(removeCompiledModules);

const source = `
  import { useState } from 'react';
  export function HiddenState() {
    const [count, setCount] = useState(0);
    return <main>
      <button data-action="later" onClick={() => globalThis.farmHiddenStateGate().then(() => {
        setCount(5);
        setCount(value => value + 2);
        setCount(value => value * 3);
      })}>Start async action</button>
      <button data-action="increment" onClick={() => setCount(value => value + 1)}>Increment</button>
      <output data-count={count} />
      <input aria-label="Draft" defaultValue="draft" />
    </main>;
  }
`;
// Fixture compilation is shared; every runtime case still mounts a fresh instance.
const fixtures = {
  static: await loadCompiledAndOriginal(source, "static"),
  hybrid: await loadCompiledAndOriginal(source, "hybrid"),
};

const cases = ["static", "hybrid"].flatMap((reactivity) =>
  ["Activity", "Suspense"].flatMap((boundary) =>
    [false, true].flatMap((hydrate) =>
      [false, true].flatMap((strict) =>
        ["hidden-completion", "visible-completion-control"].flatMap((scenario) =>
          ["original", "compiled"].map((variant) => ({
            reactivity,
            boundary,
            hydrate,
            strict,
            scenario,
            variant,
          })),
        ),
      ),
    ),
  ),
);

describe("state queued during hide/reveal", () => {
  it.each(cases)(
    "$reactivity $boundary hydrate=$hydrate strict=$strict $scenario $variant",
    async ({ reactivity, boundary, hydrate, strict, scenario, variant }) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const { original, compiled, names } = fixtures[reactivity as "static" | "hybrid"];
      expect(names).toContain("HiddenState");
      const Component = (variant === "original" ? original : compiled).HiddenState;
      let releaseBoundary!: () => void;
      const suspended = new Promise<void>((resolve) => {
        releaseBoundary = resolve;
      });
      function Guard({ hidden }: { hidden: boolean }) {
        if (hidden) throw suspended;
        return null;
      }
      const tree = (hidden: boolean) => {
        const element =
          boundary === "Activity" ? (
            <Activity mode={hidden ? "hidden" : "visible"}>
              <Component />
            </Activity>
          ) : (
            <Suspense fallback={<aside>Loading</aside>}>
              <Component />
              <Guard hidden={hidden} />
            </Suspense>
          );
        return strict ? <StrictMode>{element}</StrictMode> : element;
      };
      const container = document.createElement("div");
      document.body.append(container);
      if (hydrate) container.innerHTML = renderToString(tree(false));
      let root!: ReturnType<typeof createRoot>;
      const recoverable: unknown[] = [];
      const previousGate = (globalThis as any).farmHiddenStateGate;
      let releaseWork: (() => void) | undefined;
      let pendingWork: Promise<void> | undefined;
      try {
        await act(async () => {
          root = hydrate
            ? hydrateRoot(container, tree(false), {
                onRecoverableError: (error) => recoverable.push(error),
              })
            : createRoot(container);
          if (!hydrate) root.render(tree(false));
        });
        const output = container.querySelector("output")!;
        const input = container.querySelector("input")!;
        input.value = "edited draft";
        input.setSelectionRange(2, 5);
        expect(output.getAttribute("data-count")).toBe("0");
        for (let cycle = 0; cycle < 2; cycle++) {
          pendingWork = new Promise<void>((resolve) => {
            releaseWork = resolve;
          });
          (globalThis as any).farmHiddenStateGate = () => pendingWork;
          await act(async () =>
            container.querySelector<HTMLButtonElement>('button[data-action="later"]')!.click(),
          );
          const finishWork = () =>
            act(async () => {
              releaseWork!();
              await pendingWork;
            });
          if (scenario === "visible-completion-control") await finishWork();
          await act(async () => root.render(tree(true)));
          if (boundary === "Activity")
            expect(container.querySelector("main")!.style.display).toBe("none");
          else expect(container.querySelector("aside")?.textContent).toBe("Loading");
          if (scenario === "hidden-completion") await finishWork();
          await act(async () => root.render(tree(false)));
          expect(container.querySelector("output")).toBe(output);
          expect(output.getAttribute("data-count")).toBe("21");
          await act(async () =>
            container.querySelector<HTMLButtonElement>('button[data-action="increment"]')!.click(),
          );
          expect(output.getAttribute("data-count")).toBe("22");
          expect(container.querySelector("input")).toBe(input);
          expect(input.value).toBe("edited draft");
          expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
          expect(container.querySelector("aside")).toBeNull();
        }
        expect(recoverable).toEqual([]);
      } finally {
        await act(async () => {
          root?.unmount();
          releaseWork?.();
          releaseBoundary();
          await pendingWork;
          await suspended;
        });
        container.remove();
        if (previousGate === undefined) delete (globalThis as any).farmHiddenStateGate;
        else (globalThis as any).farmHiddenStateGate = previousGate;
      }
    },
  );
});

describe("queued state at lifecycle boundaries", () => {
  it.each(
    cases.filter(
      ({ hydrate, strict, scenario }) => !hydrate && !strict && scenario === "hidden-completion",
    ),
  )(
    "keeps a synchronous update queued just before hiding ($reactivity $boundary $variant)",
    async ({ reactivity, boundary, variant }) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const Component =
        fixtures[reactivity as "static" | "hybrid"][variant as "original" | "compiled"].HiddenState;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      function Guard({ hidden }: { hidden: boolean }) {
        if (hidden) throw pending;
        return null;
      }
      const tree = (hidden: boolean) =>
        boundary === "Activity" ? (
          <Activity mode={hidden ? "hidden" : "visible"}>
            <Component />
          </Activity>
        ) : (
          <Suspense fallback={<aside>Loading</aside>}>
            <Component />
            <Guard hidden={hidden} />
          </Suspense>
        );
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => root.render(tree(false)));
        await act(async () => {
          container.querySelector<HTMLButtonElement>('[data-action="increment"]')!.click();
          // Hide before the compiler's queued microtask gets to run.
          flushSync(() => root.render(tree(true)));
        });
        await act(async () => root.render(tree(false)));
        expect(container.querySelector("output")?.getAttribute("data-count")).toBe("1");
      } finally {
        await act(async () => {
          root.unmount();
          release();
          await pending;
        });
        container.remove();
      }
    },
  );

  it.each(["static", "hybrid"] as const)(
    "does not apply late async updates after real unmount (%s)",
    async (reactivity) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      for (const Component of [
        fixtures[reactivity].original.HiddenState,
        fixtures[reactivity].compiled.HiddenState,
      ]) {
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        const previousGate = (globalThis as any).farmHiddenStateGate;
        (globalThis as any).farmHiddenStateGate = () => pending;
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        try {
          await act(async () => root.render(<Component />));
          const output = container.querySelector("output")!;
          await act(async () =>
            container.querySelector<HTMLButtonElement>('[data-action="later"]')!.click(),
          );
          await act(async () => root.unmount());
          await act(async () => {
            release();
            await pending;
          });
          expect(container.childNodes.length).toBe(0);
          expect(output.getAttribute("data-count")).toBe("0");
        } finally {
          await act(async () => {
            root.unmount();
            release();
            await pending;
          });
          container.remove();
          if (previousGate === undefined) delete (globalThis as any).farmHiddenStateGate;
          else (globalThis as any).farmHiddenStateGate = previousGate;
        }
      }
    },
  );
});
