import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const BLOCKED =
  "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')";

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

afterAll(removeCompiledModules);

async function mount(Component: React.ComponentType<Record<string, unknown>>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<Component />));
  return container;
}

async function expectSameAsReact(source: string, name: string, clicks: string[]) {
  const { compiled, original, names, reasons } = await loadCompiledAndOriginal(source);
  expect(reasons).toEqual([]);
  expect(names).toContain(name);
  const reactContainer = await mount(original[name]);
  const compiledContainer = await mount(compiled[name]);
  expect(compiledContainer.innerHTML).toBe(reactContainer.innerHTML);
  for (const selector of clicks) {
    for (const container of [reactContainer, compiledContainer]) {
      await act(async () => container.querySelector<HTMLElement>(selector)!.click());
    }
    expect(compiledContainer.innerHTML).toBe(reactContainer.innerHTML);
  }
  return compiledContainer;
}

// Spellings the URL parser still reads as javascript:.
const RUN = "alert(document.domain)";
const PAYLOADS = [
  `javascript:${RUN}`,
  ` JaVaScRiPt:${RUN}`,
  `java\\tscript:${RUN}`,
  `\\u0001javascript:${RUN}`,
  `java\\r\\nscript:${RUN}`,
  `j\\ta\\nv\\rascript:${RUN}`,
];

describe("compiled updates block javascript: URLs like React", () => {
  it("does not read the tag name when updating non-URL attributes", async () => {
    const source = `
      import { useState } from "react";
      export function Attributes() {
        const [value, setValue] = useState("before");
        return <main>
          <button id="set" onClick={() => setValue("after")}>set</button>
          <label id="target" className={value} title={value} htmlFor={value}
            aria-label={value} data-state={value}>Label</label>
        </main>;
      }
    `;
    const { compiled, original, names, reasons } = await loadCompiledAndOriginal(source);
    expect(reasons).toEqual([]);
    expect(names).toContain("Attributes");
    const control = await mount(original.Attributes);
    const container = await mount(compiled.Attributes);
    const target = container.querySelector("#target")!;
    const tagReads = vi.spyOn(target, "localName", "get");
    await act(async () => container.querySelector<HTMLElement>("#set")!.click());
    expect(tagReads).not.toHaveBeenCalled();
    tagReads.mockRestore();
    await act(async () => control.querySelector<HTMLElement>("#set")!.click());
    expect(container.innerHTML).toBe(control.innerHTML);
    expect(container.querySelector("#target")).toBe(target);
    for (const name of ["class", "title", "for", "aria-label", "data-state"]) {
      expect(target.getAttribute(name)).toBe("after");
    }
  });

  it.each(PAYLOADS)("single-value bindings: %j", async (payload) => {
    const source = `
      import { useState } from "react";
      export function Single() {
        const [url, setUrl] = useState("https://ok.example/");
        return (
          <main>
            <button id="set" onClick={() => setUrl("${payload}")}>set</button>
            <button id="reset" onClick={() => setUrl("https://ok.example/next")}>reset</button>
            <a id="link" href={url}>go</a>
            <img src={url} />
            <embed src={url} />
            <form action={url}><button formAction={url}>send</button></form>
            <object data={url} />
            <svg><a href={url}><text>svg</text></a></svg>
            <farm-link href={url} />
            <div data={url} />
          </main>
        );
      }
    `;
    const container = await expectSameAsReact(source, "Single", ["#set", "#reset", "#set"]);
    expect(container.querySelector("#link")!.getAttribute("href")).toBe(BLOCKED);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(BLOCKED);
    expect(container.querySelector("embed")!.getAttribute("src")).toBe(BLOCKED);
    expect(container.querySelector("button[formaction]")!.getAttribute("formaction")).toBe(BLOCKED);
    expect(container.querySelector("form")!.getAttribute("action")).toBe(BLOCKED);
    expect(container.querySelector("object")!.getAttribute("data")).toBe(BLOCKED);
    // React leaves custom elements and non-URL props alone; so does the compiler.
    expect(container.querySelector("farm-link")!.getAttribute("href")).not.toBe(BLOCKED);
    expect(container.querySelector("div[data]")!.getAttribute("data")).not.toBe(BLOCKED);
  });

  it("keyed rows, for added rows and updated rows", async () => {
    const source = `
      import { useState } from "react";
      export function Links() {
        const [items, setItems] = useState([{ id: "a", url: "https://ok.example/" }]);
        return (
          <section>
            <button id="add" onClick={() => setItems((c) => [...c, { id: "b", url: "javascript:alert(document.domain)" }])}>Add</button>
            <button id="edit" onClick={() => setItems((c) => c.map((i) => ({ ...i, url: " java\\nscript:alert(1)" })))}>Edit</button>
            <button id="safe" onClick={() => setItems((c) => c.map((i) => ({ ...i, url: "/" + i.id })))}>Safe</button>
            <ul>{items.map((item) => <li key={item.id}><a href={item.url}>{item.id}</a><form action={item.url} /></li>)}</ul>
          </section>
        );
      }
    `;
    const container = await expectSameAsReact(source, "Links", ["#add", "#edit", "#safe", "#edit"]);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([BLOCKED, BLOCKED]);
    expect(
      [...container.querySelectorAll("form")].map((form) => form.getAttribute("action")),
    ).toEqual([BLOCKED, BLOCKED]);
  });
});
