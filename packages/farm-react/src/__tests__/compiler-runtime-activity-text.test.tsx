import React, { act, Activity, StrictMode, Suspense } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

afterAll(removeCompiledModules);

const sources = [
  `
      import { useState } from 'react';
      export function ResumeText() {
        const [value, setValue] = useState('before');
        return <main>
          <button data-action="clear" onClick={() => setValue([])}>Clear</button>
          <button data-action="nested" onClick={() => setValue(['one', ['two', 3]])}>Nested</button>
          <button data-action="reset" onClick={() => setValue('before')}>Reset</button>
          <p>prefix {value} suffix</p><output>{value}</output>
          <input aria-label="Draft" defaultValue="draft" />
        </main>;
      }
    `,
];
const fixtures = {
  static: await Promise.all(sources.map((source) => loadCompiledAndOriginal(source, "static"))),
  hybrid: await Promise.all(sources.map((source) => loadCompiledAndOriginal(source, "hybrid"))),
};

const cases = ["static", "hybrid"].flatMap((reactivity) =>
  ["Activity", "Suspense"].flatMap((boundary) =>
    [false, true].flatMap((hydrate) =>
      [false, true].flatMap((strict) =>
        ["original", "compiled"].map((variant) => ({
          reactivity,
          boundary,
          hydrate,
          strict,
          variant,
        })),
      ),
    ),
  ),
);

describe("root text reappearance", () => {
  it.each(cases)(
    "$reactivity $boundary hydrate=$hydrate strict=$strict $variant",
    async ({ reactivity, boundary, hydrate, strict, variant }) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const { compiled, original, names } = fixtures[reactivity as "static" | "hybrid"][0];
      expect(names).toContain("ResumeText");
      const Component = (variant === "original" ? original : compiled).ResumeText;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      function Guard({ hidden }: { hidden: boolean }) {
        if (hidden) throw pending;
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
      // React leaves its top-level SSR boundary markers after root unmount.
      // The ordinary-React control establishes this cleanup contract.
      const boundaryMarkers = [...container.childNodes]
        .filter((node) => node.nodeType === 8)
        .map((node) => ({ type: node.nodeType, text: node.textContent }));
      const recoverable: unknown[] = [];
      let root!: ReturnType<typeof createRoot>;
      await act(async () => {
        root = hydrate
          ? hydrateRoot(container, tree(false), {
              onRecoverableError: (error) => recoverable.push(error),
            })
          : createRoot(container);
        if (!hydrate) root.render(tree(false));
      });
      const paragraph = container.querySelector("p")!;
      const output = container.querySelector("output")!;
      const input = container.querySelector("input")!;
      input.value = "edited draft";
      input.setSelectionRange(2, 5);
      try {
        for (const [action, expected] of [
          ["clear", ""],
          ["nested", "onetwo3"],
          ["reset", "before"],
          ["clear", ""],
        ]) {
          await act(async () =>
            container.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!.click(),
          );
          expect(paragraph.textContent).toBe(`prefix ${expected} suffix`);
          await act(async () => root.render(tree(true)));
          if (boundary === "Suspense")
            expect(container.querySelector("aside")?.textContent).toBe("Loading");
          else expect(container.querySelector("main")!.style.display).toBe("none");
          await act(async () => root.render(tree(false)));
          expect(container.querySelector("p")).toBe(paragraph);
          expect(container.querySelector("output")).toBe(output);
          expect(paragraph.textContent).toBe(`prefix ${expected} suffix`);
          expect(output.textContent).toBe(expected);
          expect(container.querySelector("input")).toBe(input);
          expect(input.value).toBe("edited draft");
          expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
          expect(container.querySelector("aside")).toBeNull();
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
      // Check successful cleanup without masking an earlier lifecycle exception.
      expect(
        [...container.childNodes].map((node) => ({
          type: node.nodeType,
          text: node.textContent,
        })),
      ).toEqual(boundaryMarkers);
    },
  );
});
