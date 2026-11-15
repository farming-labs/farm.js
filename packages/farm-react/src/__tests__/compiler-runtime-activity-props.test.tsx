import React, { act, Activity, StrictMode, Suspense } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

afterAll(removeCompiledModules);

const sources = [
  `
        import { useState } from 'react';
        export function ResumeDependency({ useLeft }) {
          const [left, setLeft] = useState(0);
          const [right, setRight] = useState(0);
          return <main>
            <button data-action="left" onClick={() => setLeft(value => value + 1)}>Left</button>
            <button data-action="right" onClick={() => setRight(value => value + 1)}>Right</button>
            <output data-left={left} data-right={right} data-result={useLeft ? left : right} />
          </main>;
        }
      `,
  `
      import { useState } from 'react';
      export function ResumeProps({ next }) {
        const [value, setValue] = useState('untouched');
        return <main>
          <button onClick={() => setValue(next)}>Read prop</button>
          <output data-next={next} data-value={value} />
          <input aria-label="Draft" defaultValue="draft" />
        </main>;
      }
    `,
];
const fixtures = {
  static: await Promise.all(sources.map((source) => loadCompiledAndOriginal(source, "static"))),
  hybrid: await Promise.all(sources.map((source) => loadCompiledAndOriginal(source, "hybrid"))),
};

describe.each(["static", "hybrid"] as const)(
  "prop-dependent binding resumption (%s)",
  (reactivity) => {
    describe.each(["Activity", "Suspense"])("%s", (boundary) => {
      it.each(["original", "compiled"] as const)(
        "tracks the selected branch after reveal (%s)",
        async (variant) => {
          globalThis.IS_REACT_ACT_ENVIRONMENT = true;
          const { original, compiled, names } = fixtures[reactivity as "static" | "hybrid"][0];
          expect(names).toContain("ResumeDependency");
          const Component = (variant === "original" ? original : compiled).ResumeDependency;
          const container = document.createElement("div");
          document.body.append(container);
          const root = createRoot(container);
          let release!: () => void;
          const pending = new Promise<void>((resolve) => {
            release = resolve;
          });
          function Guard({ hidden }: { hidden: boolean }) {
            if (hidden) throw pending;
            return null;
          }
          const render = (hidden: boolean, useLeft: boolean) =>
            act(async () =>
              root.render(
                boundary === "Activity" ? (
                  <Activity mode={hidden ? "hidden" : "visible"}>
                    <Component useLeft={useLeft} />
                  </Activity>
                ) : (
                  <Suspense fallback={<aside>Loading</aside>}>
                    <Component useLeft={useLeft} />
                    <Guard hidden={hidden} />
                  </Suspense>
                ),
              ),
            );
          try {
            await render(false, true);
            await render(true, true);
            await render(false, false);
            const output = container.querySelector("output")!;
            await act(async () =>
              container.querySelector<HTMLButtonElement>('button[data-action="right"]')!.click(),
            );
            expect(output.getAttribute("data-right")).toBe("1");
            expect(output.getAttribute("data-result")).toBe("1");
            await act(async () =>
              container.querySelector<HTMLButtonElement>('button[data-action="left"]')!.click(),
            );
            expect(output.getAttribute("data-result")).toBe("1");
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
    });
  },
);

const cases = ["static", "hybrid"].flatMap((reactivity) =>
  ["Activity", "Suspense"].flatMap((boundary) =>
    [false, true].flatMap((hydrate) =>
      [false, true].flatMap((strict) =>
        ["reveal-change", "hidden-change", "visible-change-control", "unchanged-control"].flatMap(
          (scenario) =>
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

describe("prop reappearance", () => {
  it.each(cases)(
    "$reactivity $boundary hydrate=$hydrate strict=$strict $scenario $variant",
    async ({ reactivity, boundary, hydrate, strict, scenario, variant }) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const { compiled, original, names } = fixtures[reactivity as "static" | "hybrid"][1];
      expect(names).toContain("ResumeProps");
      const Component = (variant === "original" ? original : compiled).ResumeProps;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      function Guard({ hidden }: { hidden: boolean }) {
        if (hidden) throw pending;
        return null;
      }
      const tree = (hidden: boolean, next: string) => {
        const element =
          boundary === "Activity" ? (
            <Activity mode={hidden ? "hidden" : "visible"}>
              <Component next={next} />
            </Activity>
          ) : (
            <Suspense fallback={<aside>Loading</aside>}>
              <Component next={next} />
              <Guard hidden={hidden} />
            </Suspense>
          );
        return strict ? <StrictMode>{element}</StrictMode> : element;
      };
      const container = document.createElement("div");
      document.body.append(container);
      if (hydrate) container.innerHTML = renderToString(tree(false, "before"));
      const recoverable: unknown[] = [];
      let root!: ReturnType<typeof createRoot>;
      await act(async () => {
        root = hydrate
          ? hydrateRoot(container, tree(false, "before"), {
              onRecoverableError: (error) => recoverable.push(error),
            })
          : createRoot(container);
        if (!hydrate) root.render(tree(false, "before"));
      });
      const output = container.querySelector("output")!;
      const input = container.querySelector("input")!;
      input.value = "edited draft";
      input.setSelectionRange(2, 5);
      const render = (hidden: boolean, next: string) =>
        act(async () => root.render(tree(hidden, next)));
      try {
        let last = "before";
        for (const next of scenario === "unchanged-control"
          ? ["before", "before"]
          : ["after", "latest"]) {
          if (scenario === "visible-change-control") {
            await render(false, next);
            last = next;
          }
          await render(true, last);
          if (boundary === "Suspense")
            expect(container.querySelector("aside")?.textContent).toBe("Loading");
          else expect(container.querySelector("main")!.style.display).toBe("none");
          if (scenario === "hidden-change") await render(true, next);
          await render(false, next);
          expect(container.querySelector("output")).toBe(output);
          expect(output.getAttribute("data-next")).toBe(next);
          await act(async () => container.querySelector("button")!.click());
          expect(output.getAttribute("data-value")).toBe(next);
          expect(container.querySelector("input")).toBe(input);
          expect(input.value).toBe("edited draft");
          expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
          expect(container.querySelector("aside")).toBeNull();
          last = next;
        }
        expect(recoverable).toEqual([]);
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
});
