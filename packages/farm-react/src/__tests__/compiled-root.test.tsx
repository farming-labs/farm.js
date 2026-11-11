import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCompiledRoot } from "../compiled-root";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

const reactRoots = new Set<Root>();
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of reactRoots) root.unmount();
  });
  reactRoots.clear();
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

/** Markup with attributes in a stable order: React and the compiled root may order them apart. */
function normalized(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  const attributes = [...node.attributes]
    .map((attribute) => `${attribute.name}="${attribute.value}"`)
    .sort()
    .join(" ");
  const children = [...node.childNodes].map(normalized).join("");
  return `<${node.localName}${attributes ? ` ${attributes}` : ""}>${children}</${node.localName}>`;
}

function container(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

async function renderWithReact(Component: React.ComponentType<Record<string, unknown>>) {
  const host = container();
  const root = createRoot(host);
  reactRoots.add(root);
  await act(async () => root.render(<Component />));
  return host;
}

const TASKS = `
  import { useState } from "react";
  export function Tasks() {
    const [items, setItems] = useState([{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }]);
    const [selected, setSelected] = useState("a");
    const [count, setCount] = useState(0);
    return (
      <main className="tasks">
        <button id="add" type="button" onClick={() => {
          setCount(count + 1);
          setItems([...items, { id: "c" + count, label: "Item " + count }]);
        }}>Add</button>
        <p aria-live="polite" data-count={count}>{count} added</p>
        <ul>
          {items.map((item) => (
            <li key={item.id} className={selected === item.id ? "selected" : ""}>
              <a onClick={() => setSelected(item.id)}>{item.label}</a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
`;

describe("createCompiledRoot", () => {
  it("mounts and updates a compiled tree like React DOM, without loading it", async () => {
    const { compiled, original, names } = await loadCompiledAndOriginal(TASKS);
    expect(names).toContain("Tasks");
    const reference = await renderWithReact(original.Tasks);

    const host = container();
    const onFallback = vi.fn();
    createCompiledRoot(host, { onFallback }).render(<compiled.Tasks />);
    expect(onFallback).not.toHaveBeenCalled();
    expect(normalized(host)).toBe(normalized(reference));

    for (const target of [host, reference]) {
      await act(async () => {
        target.querySelector<HTMLButtonElement>("#add")!.click();
        target.querySelectorAll<HTMLAnchorElement>("li a")[1]!.click();
      });
    }
    expect(normalized(host)).toBe(normalized(reference));
    expect(host.querySelectorAll("li")).toHaveLength(3);
    expect(host.querySelector(".selected")?.textContent).toBe("Beta");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back to React DOM for a component that calls hooks", async () => {
    const { original } = await loadCompiledAndOriginal(TASKS);
    const reference = await renderWithReact(original.Tasks);
    const host = container();
    const onFallback = vi.fn();
    const root = createCompiledRoot(host, { onFallback });
    root.render(<original.Tasks />);
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("Tasks"));
    await vi.waitFor(() => expect(host.querySelectorAll("li")).toHaveLength(2));
    expect(normalized(host)).toBe(normalized(reference));
    await act(async () => root.unmount());
    expect(host.childNodes).toHaveLength(0);
  });

  it("leaves props React renames to React DOM before showing anything", async () => {
    const host = container();
    const onFallback = vi.fn();
    createCompiledRoot(host, { onFallback }).render(
      <form>
        <input autoFocus defaultValue="x" />
      </form>,
    );
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("autoFocus"));
    expect(host.childNodes).toHaveLength(0);
    await vi.waitFor(() => expect(host.querySelector("input")?.value).toBe("x"));
  });

  it("hands a mounted root to React DOM when a compiled component needs React", async () => {
    const { compiled, original } = await loadCompiledAndOriginal(`
      import { useState } from "react";
      export function Rows() {
        const [items, setItems] = useState([{ id: "a" }, { id: "b" }]);
        return (
          <main>
            <button id="duplicate" onClick={() => setItems([{ id: "a" }, { id: "a" }])}>Duplicate</button>
            <ul>{items.map((item, index) => <li key={item.id}>{item.id}{index}</li>)}</ul>
          </main>
        );
      }
    `);
    const reference = await renderWithReact(original.Rows);
    const host = container();
    const onFallback = vi.fn();
    createCompiledRoot(host, { onFallback }).render(<compiled.Rows />);
    expect(onFallback).not.toHaveBeenCalled();

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const target of [host, reference]) {
        await act(async () => target.querySelector<HTMLButtonElement>("#duplicate")!.click());
      }
      await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
      // React renders the root from its initial state.
      await vi.waitFor(() => expect(host.querySelectorAll("li")).toHaveLength(2));
      expect(normalized(host.querySelector("main")!)).toContain('<button id="duplicate">');
    } finally {
      error.mockRestore();
    }
  });

  it("unmounts compiled components and clears the container", async () => {
    const { compiled } = await loadCompiledAndOriginal(TASKS);
    const host = container();
    const root = createCompiledRoot(host, { onFallback: vi.fn() });
    root.render(<compiled.Tasks />);
    expect(host.querySelector("li")).not.toBeNull();
    root.unmount();
    expect(host.childNodes).toHaveLength(0);
  });
});
