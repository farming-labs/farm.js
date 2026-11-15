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

/** Clears the hook dispatcher React DOM leaves behind, as on a page that never loaded React DOM. */
function withoutReactDispatcher(run: () => void) {
  const internals = React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
      ReactCurrentDispatcher: { current: unknown };
    };
  };
  const holder = internals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
    ? {
        get: () => internals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE!.H,
        set: (value: unknown) =>
          (internals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE!.H = value),
      }
    : {
        get: () =>
          internals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED!.ReactCurrentDispatcher
            .current,
        set: (value: unknown) =>
          (internals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED!.ReactCurrentDispatcher.current =
            value),
      };
  const previous = holder.get();
  holder.set(null);
  try {
    run();
  } finally {
    holder.set(previous);
  }
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
    const error = vi.spyOn(console, "error");
    const root = createCompiledRoot(host, { onFallback });
    try {
      // As on a page that has not loaded React DOM: the hook call is rejected before React can
      // report an invalid hook call.
      withoutReactDispatcher(() => root.render(<original.Tasks />));
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("Tasks, which calls hooks"));
    await vi.waitFor(() => expect(host.querySelectorAll("li")).toHaveLength(2));
    expect(normalized(host)).toBe(normalized(reference));
    await act(async () => root.unmount());
    expect(host.childNodes).toHaveLength(0);
  });

  it("restores React's dispatcher after rejecting a hook", async () => {
    const { original } = await loadCompiledAndOriginal(TASKS);
    createCompiledRoot(container(), { onFallback: vi.fn() }).render(<original.Tasks />);
    // Hooks still work in components React renders afterwards.
    const reference = await renderWithReact(original.Tasks);
    expect(reference.querySelectorAll("li")).toHaveLength(2);
  });

  it("uses React DOM on pages with Fast Refresh, which updates only React DOM roots", async () => {
    const { compiled } = await loadCompiledAndOriginal(TASKS);
    const refresh = globalThis as { $RefreshReg$?: unknown };
    refresh.$RefreshReg$ = () => {};
    try {
      const host = container();
      const onFallback = vi.fn();
      const root = createCompiledRoot(host, { onFallback });
      root.render(<compiled.Tasks />);
      expect(host.childNodes).toHaveLength(0);
      await vi.waitFor(() => expect(host.querySelectorAll("li")).toHaveLength(2));
      expect(Object.keys(host).some((key) => key.startsWith("__reactContainer"))).toBe(true);
      // Development behaviour, not a problem with the tree: nothing to report.
      expect(onFallback).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    } finally {
      delete refresh.$RefreshReg$;
    }
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

  it("falls back silently unless onFallback is given", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    try {
      const host = container();
      const root = createCompiledRoot(host, {});
      await act(async () => root.render(<input autoFocus defaultValue="x" />));
      await vi.waitFor(() => expect(host.querySelector("input")?.value).toBe("x"));
      await act(async () => root.unmount());
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
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
