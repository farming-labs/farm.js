import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

afterAll(removeCompiledModules);

describe.each(["static", "hybrid"] as const)("root text ownership (%s)", (reactivity) => {
  it("reuses only compiler-owned text and falls back for changed child shapes", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { compiled, names } = await loadCompiledAndOriginal(
      `
    import { useState } from 'react';
    export function OwnedText({ next, gate }) {
      const [value, setValue] = useState('before');
      return <main data-gate={gate ? 'yes' : 'no'}>
        <button onClick={() => setValue(next)}>Update</button>
        <p>prefix {value} suffix</p><output>{value}</output>
      </main>;
    }
  `,
      reactivity,
    );
    expect(names).toContain("OwnedText");
    const Component = compiled.OwnedText;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (next: unknown, gate: unknown = false) =>
      act(async () => root.render(<Component next={next} gate={gate} />));
    const click = () => act(async () => container.querySelector("button")!.click());
    try {
      await render("first");
      const paragraph = container.querySelector("p")!;
      const output = container.querySelector("output")!;
      const committed = [...paragraph.childNodes];
      const committedText = committed.map((node) => node.textContent);
      await click();
      const owned = paragraph.firstChild;
      expect(committed).not.toContain(owned);
      await render("second");
      await click();
      expect(paragraph.firstChild).toBe(owned);
      expect(paragraph.textContent).toBe("prefix second suffix");
      expect(committed.map((node) => node.textContent)).toEqual(committedText);

      // Empty content and a changed child shape must use textContent's full replacement.
      await render(null);
      await click();
      expect(output.childNodes.length).toBe(0);
      for (const nodes of [
        [],
        [document.createElement("span")],
        [document.createTextNode("x"), document.createComment("extra")],
      ]) {
        paragraph.replaceChildren(...nodes);
        await render(String(nodes.length));
        await click();
        expect(paragraph.childNodes.length).toBe(1);
        expect(paragraph.textContent).toBe(`prefix ${nodes.length} suffix`);
      }

      await render("handoff", {});
      expect([...paragraph.childNodes]).toEqual(committed);
      expect(paragraph.textContent).toBe("prefix 2 suffix");
      await click();
      expect(paragraph.textContent).toBe("prefix handoff suffix");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it.each([false, true])(
    "preserves root text across prop renders (hydrated=%s)",
    async (hydrate) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const { compiled, original, names } = await loadCompiledAndOriginal(
        `
    import { useState } from 'react';
    export function RootTextOwnership({ next }) {
      const [value, setValue] = useState('before');
      return <main><button onClick={() => setValue(next)}>Update</button>
        <p>{value}</p><p>prefix {value} suffix</p>
        <input aria-label="Draft" defaultValue="draft" />
      </main>;
    }
  `,
        reactivity,
      );
      expect(names).toContain("RootTextOwnership");
      for (const Component of [original.RootTextOwnership, compiled.RootTextOwnership]) {
        const container = document.createElement("div");
        document.body.append(container);
        const element = (
          <StrictMode>
            <Component next="after" />
          </StrictMode>
        );
        let root!: ReturnType<typeof createRoot>;
        if (hydrate) container.innerHTML = renderToString(element);
        await act(async () => {
          root = hydrate ? hydrateRoot(container, element) : createRoot(container);
          if (!hydrate) root.render(element);
        });
        const input = container.querySelector("input")!;
        const paragraphs = [...container.querySelectorAll("p")];
        input.value = "edited draft";
        input.focus();
        input.setSelectionRange(2, 5);
        try {
          for (const [next, expected] of [
            ["after", "after"],
            [null, ""],
            [[], ""],
            [["one"], "one"],
            [false, ""],
            [0, "0"],
            ["", ""],
            [["one", ["two", null, 3]], "onetwo3"],
            ["before", "before"],
          ] as const) {
            await act(async () =>
              root.render(
                <StrictMode>
                  <Component next={next} />
                </StrictMode>,
              ),
            );
            await act(async () => container.querySelector("button")!.click());
            expect(paragraphs[0].textContent).toBe(expected);
            expect(paragraphs[1].textContent).toBe(`prefix ${expected} suffix`);
            expect([...container.querySelectorAll("p")]).toEqual(paragraphs);
            expect(container.querySelector("input")).toBe(input);
            expect(document.activeElement).toBe(input);
            expect(input.value).toBe("edited draft");
            expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
          }
        } finally {
          await act(async () => root.unmount());
          container.remove();
        }
      }
    },
  );

  it("invalidates binding values after a full prop render", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { compiled, original, names } = await loadCompiledAndOriginal(
      `
    import { useState } from 'react';
    export function RootTextCache({ label, gate }) {
      const [count, setCount] = useState(0);
      return <main data-gate={gate ? 'yes' : 'no'}>
        <button onClick={() => setCount(value => value + 1)}>Increment</button>
        <p>{label}:{count}</p>
      </main>;
    }
  `,
      reactivity,
    );
    expect(names).toContain("RootTextCache");
    for (const Component of [original.RootTextCache, compiled.RootTextCache]) {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        for (const [label, gate] of [
          ["before", false],
          ["after", false],
          ["full", {}],
          ["after", false],
        ] as const) {
          await act(async () =>
            root.render(
              <StrictMode>
                <Component label={label} gate={gate} />
              </StrictMode>,
            ),
          );
          expect(container.querySelector("p")?.textContent).toBe(`${label}:0`);
        }
        await act(async () => container.querySelector("button")!.click());
        expect(container.querySelector("p")?.textContent).toBe("after:1");
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    }
  });
});
