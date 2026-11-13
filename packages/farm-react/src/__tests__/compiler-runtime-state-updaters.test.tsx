import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  loadCompiledAndOriginal,
  normalizedDom,
  removeCompiledModules,
} from "./compiled-module-harness";

// React runs an event's state updaters before React DOM restores a controlled field, so an
// updater that reads the event's target sees what was typed. Compiled state must match. Each
// scenario renders the source with React and the compiled output with React DOM, then compares
// the DOM after every interaction.

const roots = new Set<Root>();
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

type Step = (host: HTMLElement) => void;
const click =
  (selector: string): Step =>
  (host) =>
    host.querySelector<HTMLElement>(selector)!.click();
const type =
  (selector: string, value: string): Step =>
  (host) => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

async function expectParity(source: string, name: string, steps: readonly Step[]) {
  const { compiled, original, names } = await loadCompiledAndOriginal(source);
  expect(names, "the scenario must compile").toContain(name);
  const hosts = [original[name]!, compiled[name]!].map((Component) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.add(root);
    return { host, root, Component };
  });
  await act(async () => {
    for (const { root, Component } of hosts) root.render(<Component />);
  });
  const [reference, subject] = hosts.map(({ host }) => host) as [HTMLElement, HTMLElement];
  expect(normalizedDom(subject)).toBe(normalizedDom(reference));
  for (const [index, step] of steps.entries()) {
    for (const { host } of hosts) await act(async () => step(host));
    expect(normalizedDom(subject), `after step ${index + 1}`).toBe(normalizedDom(reference));
  }
}

describe("compiled state updaters under React DOM", () => {
  it("read the typed value when they update a form object", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Form() {
        const [form, setForm] = useState({ name: "Ada", city: "" });
        return (
          <form>
            <input id="name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            <input id="city" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} />
            <output>{form.name}|{form.city}</output>
          </form>
        );
      }`,
      "Form",
      [type("#name", "Grace"), type("#city", "Paris"), type("#name", "Grace H")],
    );
  });

  it("read the checked state in keyed rows and React-owned lists", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Todos() {
        const [todos, setTodos] = useState([{ id: 1, title: "One", done: false }, { id: 2, title: "Two", done: true }]);
        const toggle = (id, done) => setTodos((current) => current.map((todo) => todo.id === id ? { ...todo, done } : todo));
        return (
          <section>
            <ul className="plain">
              {todos.map((todo) => (
                <li key={todo.id} data-id={todo.id}>
                  <input className="done" type="checkbox" checked={todo.done} onChange={(event) => toggle(todo.id, event.target.checked)} />
                  <input className="title" value={todo.title} onChange={(event) => { const title = event.target.value; setTodos((current) => current.map((item) => item.id === todo.id ? { ...item, title } : item)); }} />
                </li>
              ))}
            </ul>
            <ul className="branches">
              {todos.map((todo) => (
                <li key={todo.id} data-id={todo.id}>
                  {todo.done ? <s>{todo.title}</s> : <input className="edit" value={todo.title} onChange={(event) => setTodos((current) => current.map((item) => item.id === todo.id ? { ...item, title: event.target.value } : item))} />}
                </li>
              ))}
            </ul>
          </section>
        );
      }`,
      "Todos",
      [
        click('.plain [data-id="1"] .done'),
        click('.plain [data-id="2"] .done'),
        type('.plain [data-id="2"] .title', "Twice"),
        type('.branches [data-id="2"] .edit', "Two!"),
        click('.plain [data-id="1"] .done'),
        type('.branches [data-id="1"] .edit', "Uno"),
      ],
    );
  });

  it("apply in order while handlers still read the committed state", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Counter() {
        const [count, setCount] = useState(0);
        const [log, setLog] = useState("");
        return (
          <section>
            <button id="twice" onClick={() => { setCount((n) => n + 1); setCount((n) => n * 10); setLog(log + "|" + count); }}>twice</button>
            <button id="mixed" onClick={() => { setCount(count + 5); setCount((n) => n + 1); setLog((current) => current + "|" + count); }}>mixed</button>
            <output>{count}{log}</output>
          </section>
        );
      }`,
      "Counter",
      [click("#twice"), click("#mixed"), click("#twice")],
    );
  });
});
