import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCompiledRoot } from "../compiled-root";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

// Differential tests: the same source, compiled and mounted by the compiled root, must match the
// original mounted by React DOM after every interaction, whether or not the root falls back.

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

function normalized(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType === Node.COMMENT_NODE) return "";
  if (!(node instanceof Element)) return "";
  const attributes = [...node.attributes]
    .map((attribute) => `${attribute.name}="${attribute.value}"`)
    .sort()
    .join(" ");
  const state =
    node instanceof HTMLInputElement
      ? ` [value=${node.value} checked=${node.checked}]`
      : node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement
        ? ` [value=${node.value}]`
        : "";
  const children = [...node.childNodes].map(normalized).join("");
  return `<${node.localName}${attributes ? ` ${attributes}` : ""}${state}>${children}</${node.localName}>`;
}

type Step = (root: HTMLElement) => void;

const click =
  (selector: string): Step =>
  (root) =>
    root.querySelector<HTMLElement>(selector)!.click();

const type =
  (selector: string, value: string): Step =>
  (root) => {
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

const choose =
  (selector: string, value: string): Step =>
  (root) => {
    const select = root.querySelector<HTMLSelectElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

const submit =
  (selector: string): Step =>
  (root) => {
    root
      .querySelector<HTMLFormElement>(selector)!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

async function expectParity(source: string, name: string, steps: readonly Step[]) {
  const { compiled, original, names } = await loadCompiledAndOriginal(source);
  expect(names, "the scenario must compile").toContain(name);

  const reference = document.createElement("div");
  const subject = document.createElement("div");
  document.body.append(reference, subject);
  const reactRoot = createRoot(reference);
  reactRoots.add(reactRoot);
  await act(async () => reactRoot.render(React.createElement(original[name]!)));

  const fallbacks: string[] = [];
  const compiledRoot = createCompiledRoot(subject, {
    onFallback: (reason) => fallbacks.push(reason),
  });
  await act(async () => compiledRoot.render(React.createElement(compiled[name]!)));
  await vi.waitFor(() => expect(normalized(subject)).toBe(normalized(reference)));

  // Each root runs the whole sequence on its own, so one root's focus cannot blur the other.
  const expected: string[] = [];
  for (const step of steps) {
    await act(async () => step(reference));
    expected.push(normalized(reference));
  }
  for (const [index, step] of steps.entries()) {
    await act(async () => step(subject));
    await vi.waitFor(() =>
      expect(normalized(subject), `after step ${index + 1}`).toBe(expected[index]),
    );
  }
  await act(async () => compiledRoot.unmount());
  return fallbacks;
}

describe("compiled root parity with React DOM", () => {
  it("keyed rows with row-local conditionals keep state by using React DOM", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Todos() {
        const [items, setItems] = useState([
          { id: 1, label: "One", done: false },
          { id: 2, label: "Two", done: true },
          { id: 3, label: "Three", done: false },
        ]);
        const [count, setCount] = useState(0);
        const toggle = (id) => {
          setCount(count + 1);
          setItems(items.map((item) => item.id === id ? { ...item, done: !item.done } : item));
        };
        return (
          <main>
            <p id="count">{count}</p>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button className="toggle" onClick={() => toggle(item.id)}>{item.label}</button>
                  {item.done ? <span className="done">done</span> : <em>open</em>}
                </li>
              ))}
            </ul>
          </main>
        );
      }`,
      "Todos",
      [
        click("li:nth-child(1) .toggle"),
        click("li:nth-child(2) .toggle"),
        click("li:nth-child(1) .toggle"),
      ],
    );
    // Row-local conditionals are React-owned: the root uses React DOM from the start, so no
    // state is lost when a row toggles.
    expect(fallbacks).toEqual([expect.stringContaining("updates through React")]);
  });

  it("conditional blocks open and close through React DOM", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Panel() {
        const [open, setOpen] = useState(false);
        return (
          <section>
            <button id="toggle" onClick={() => setOpen(!open)}>{open ? "Close" : "Open"}</button>
            {open && <div className="body"><h2>Details</h2><p>Body</p></div>}
          </section>
        );
      }`,
      "Panel",
      [click("#toggle"), click("#toggle"), click("#toggle")],
    );
    // Conditional ranges re-render through React, so this root uses React DOM from the start.
    expect(fallbacks).toEqual([expect.stringContaining("updates through React")]);
  });

  it("controlled text input, textarea, checkbox and select", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Form() {
        const [name, setName] = useState("Ada");
        const [bio, setBio] = useState("");
        const [agree, setAgree] = useState(false);
        const [color, setColor] = useState("red");
        return (
          <form>
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} />
            <textarea id="bio" value={bio} onChange={(event) => setBio(event.target.value)} />
            <input id="agree" type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
            <select id="color" value={color} onChange={(event) => setColor(event.target.value)}>
              <option value="red">Red</option>
              <option value="green">Green</option>
            </select>
            <output>{name}|{bio}|{String(agree)}|{color}</output>
          </form>
        );
      }`,
      "Form",
      [
        type("#name", "Grace"),
        type("#bio", "Compilers"),
        click("#agree"),
        choose("#color", "green"),
        click("#agree"),
      ],
    );
    expect(fallbacks).toEqual([]);
  });

  it("form submit with preventDefault and nested stopPropagation", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Submit() {
        const [submits, setSubmits] = useState(0);
        const [outer, setOuter] = useState(0);
        return (
          <div id="outer" onClick={() => setOuter(outer + 1)}>
            <form id="form" onSubmit={(event) => { event.preventDefault(); setSubmits(submits + 1); }}>
              <button id="inner" type="button" onClick={(event) => event.stopPropagation()}>Inner</button>
            </form>
            <p>{submits}/{outer}</p>
            <button id="bubble" type="button">Bubble</button>
          </div>
        );
      }`,
      "Submit",
      [submit("#form"), click("#inner"), click("#bubble"), submit("#form")],
    );
    expect(fallbacks).toEqual([]);
  });

  it("styles, booleans, data and aria attributes", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Styled() {
        const [on, setOn] = useState(false);
        return (
          <div>
            <button id="flip" onClick={() => setOn(!on)} aria-pressed={on} data-on={on}>Flip</button>
            <div id="box" hidden={!on} tabIndex={on ? 0 : -1} title={on ? "on" : "off"}
              style={{ width: on ? 120 : 80, opacity: on ? 1 : 0.5, lineHeight: 2, "--accent": on ? "red" : "blue" }}>
              Box
            </div>
          </div>
        );
      }`,
      "Styled",
      [click("#flip"), click("#flip")],
    );
    expect(fallbacks).toEqual([]);
  });

  it("keyed reorder, removal and insertion", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Sorter() {
        const [items, setItems] = useState([{ id: "c", n: 3 }, { id: "a", n: 1 }, { id: "b", n: 2 }]);
        return (
          <div>
            <button id="sort" onClick={() => setItems([...items].sort((x, y) => x.n - y.n))}>Sort</button>
            <button id="reverse" onClick={() => setItems([...items].reverse())}>Reverse</button>
            <button id="drop" onClick={() => setItems(items.filter((item) => item.id !== "a"))}>Drop</button>
            <button id="add" onClick={() => setItems([{ id: "z", n: 0 }, ...items])}>Add</button>
            <ol>{items.map((item) => <li key={item.id} data-n={item.n}>{item.id}</li>)}</ol>
          </div>
        );
      }`,
      "Sorter",
      [click("#sort"), click("#reverse"), click("#drop"), click("#add"), click("#sort")],
    );
    expect(fallbacks).toEqual([]);
  });

  it("compiled children with props update with their parent", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      function Badge({ label, tone }) {
        return <span className={"badge " + tone}>{label}</span>;
      }
      export function Parent() {
        const [count, setCount] = useState(0);
        return (
          <div>
            <button id="inc" onClick={() => setCount(count + 1)}>Inc</button>
            <Badge label={"Count " + count} tone={count % 2 ? "odd" : "even"} />
          </div>
        );
      }`,
      "Parent",
      [click("#inc"), click("#inc"), click("#inc")],
    );
    // Badge is a module-local child with no hooks: the compiler inlines its JSX, so the
    // parent compiles as one template and the root needs no React DOM.
    expect(fallbacks).toEqual([]);
  });

  it("filter buttons rendered from an array literal", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Filters() {
        const [filter, setFilter] = useState("all");
        return (
          <section>
            <nav>
              {["all", "active", "done"].map((name) => (
                <button key={name} id={name} className={filter === name ? "selected" : ""}
                  aria-pressed={filter === name} onClick={() => setFilter(name)}>
                  {name}
                </button>
              ))}
            </nav>
            <p id="current">{filter}</p>
          </section>
        );
      }`,
      "Filters",
      [click("#active"), click("#done"), click("#done"), click("#all")],
    );
    expect(fallbacks).toEqual([]);
  });

  it("a todo list with filters and counts of filtered rows", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Todos() {
        const [todos, setTodos] = useState([
          { id: 1, text: "Write", done: true },
          { id: 2, text: "Ship", done: false },
        ]);
        const [draft, setDraft] = useState("");
        const [nextId, setNextId] = useState(3);
        const [filter, setFilter] = useState("all");
        const visible = todos.filter((todo) => filter === "all" || (filter === "done") === todo.done);
        const remaining = todos.filter((todo) => !todo.done).length;
        return (
          <section>
            <form id="new" onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim()) return;
              setTodos([...todos, { id: nextId, text: draft.trim(), done: false }]);
              setNextId(nextId + 1);
              setDraft("");
            }}>
              <input id="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
            </form>
            <ul>
              {visible.map((todo) => (
                <li key={todo.id} data-id={todo.id} className={todo.done ? "completed" : ""}>
                  <input className="toggle" type="checkbox" checked={todo.done}
                    onChange={() => setTodos(todos.map((item) => item.id === todo.id ? { ...item, done: !item.done } : item))} />
                  <label>{todo.text}</label>
                  <button className="destroy" onClick={() => setTodos(todos.filter((item) => item.id !== todo.id))}>x</button>
                </li>
              ))}
            </ul>
            <button id="all" onClick={() => setFilter("all")}>All</button>
            <button id="active" onClick={() => setFilter("active")}>Active</button>
            <button id="done" onClick={() => setFilter("done")}>Done</button>
            <button id="clear" onClick={() => setTodos(todos.filter((todo) => !todo.done))}>Clear</button>
            <footer data-left={remaining}>{remaining === 1 ? "1 item left" : remaining + " items left"}</footer>
            <p id="done-count">{todos.filter((todo) => todo.done).length} done</p>
          </section>
        );
      }`,
      "Todos",
      [
        type("#draft", "Test"),
        submit("#new"),
        type("#draft", "   "),
        submit("#new"),
        click('li[data-id="2"] .toggle'),
        click("#active"),
        click('li[data-id="3"] .toggle'),
        click("#done"),
        click('li[data-id="1"] .destroy'),
        click("#all"),
        click("#clear"),
        type("#draft", "Again"),
        submit("#new"),
      ],
    );
    // Row onChange handlers keep rows React-owned under React DOM; this root maps them to
    // native events itself, so the whole todo list runs without React DOM.
    expect(fallbacks).toEqual([]);
  });

  it("filtered rows and their counts update without React DOM", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Board() {
        const [cards, setCards] = useState([
          { id: 1, title: "Plan", done: true },
          { id: 2, title: "Build", done: false },
        ]);
        const [nextId, setNextId] = useState(3);
        const [showDone, setShowDone] = useState(true);
        const shown = cards.filter((card) => showDone || !card.done);
        const open = cards.filter((card) => !card.done).length;
        return (
          <section>
            <button id="add" onClick={() => {
              setCards([...cards, { id: nextId, title: "Card " + nextId, done: false }]);
              setNextId(nextId + 1);
            }}>Add</button>
            <button id="toggle-done" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide done" : "Show done"}</button>
            <ul>
              {shown.map((card) => (
                <li key={card.id} data-id={card.id} className={card.done ? "done" : "open"}>
                  <span>{card.title}</span>
                  <button className="finish" onClick={() => setCards(cards.map((item) => item.id === card.id ? { ...item, done: !item.done } : item))}>Finish</button>
                </li>
              ))}
            </ul>
            <p id="open" data-open={open}>{open === 1 ? "1 open card" : open + " open cards"}</p>
            <p id="total">{cards.filter((card) => card.done).length} of {cards.length} done</p>
          </section>
        );
      }`,
      "Board",
      [
        click("#add"),
        click('li[data-id="3"] .finish'),
        click("#toggle-done"),
        click('li[data-id="2"] .finish'),
        click("#add"),
        click("#toggle-done"),
        click('li[data-id="1"] .finish'),
      ],
    );
    expect(fallbacks).toEqual([]);
  });

  it("a page of hook-free child components with props", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      function Header({ title, count }) {
        return <header><h1>{title}</h1><small data-count={count}>{count} total</small></header>;
      }
      const Stat = ({ label, value }) => <p className="stat"><b>{label}</b><span>{value}</span></p>;
      function Footer({ remaining, onClear }) {
        return (
          <footer>
            <span>{remaining === 1 ? "1 item left" : remaining + " items left"}</span>
            <button id="clear" onClick={onClear}>Clear</button>
          </footer>
        );
      }
      export function Page() {
        const [items, setItems] = useState(3);
        const [cleared, setCleared] = useState(0);
        return (
          <section>
            <Header title="Inventory" count={items} />
            <button id="add" onClick={() => setItems(items + 1)}>Add</button>
            <Stat label="Cleared" value={cleared} />
            <Footer remaining={items} onClear={() => { setItems(0); setCleared(cleared + 1); }} />
          </section>
        );
      }`,
      "Page",
      [click("#add"), click("#add"), click("#clear"), click("#add")],
    );
    expect(fallbacks).toEqual([]);
  });

  it("onChange on rows added after mount: text, checkbox and select", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Editor() {
        const [rows, setRows] = useState([{ id: 1, label: "One", done: false, size: "s" }]);
        const update = (id, patch) =>
          setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
        return (
          <section>
            <button id="add" onClick={() => setRows([...rows, { id: rows.length + 1, label: "", done: false, size: "s" }])}>Add</button>
            <ul>
              {rows.map((row) => (
                <li key={row.id} data-id={row.id}>
                  <input className="label" value={row.label} onChange={(event) => update(row.id, { label: event.target.value })} />
                  <input className="done" type="checkbox" checked={row.done} onChange={(event) => update(row.id, { done: event.target.checked })} />
                  <select className="size" value={row.size} onChange={(event) => update(row.id, { size: event.target.value })}>
                    <option value="s">S</option>
                    <option value="l">L</option>
                  </select>
                </li>
              ))}
            </ul>
            <output>{rows.filter((row) => row.done).length} done</output>
          </section>
        );
      }`,
      "Editor",
      [
        click("#add"),
        type('li[data-id="2"] .label', "Two"),
        click('li[data-id="2"] .done'),
        choose('li[data-id="2"] .size', "l"),
        click('li[data-id="1"] .done'),
        click("#add"),
        type('li[data-id="3"] .label', "Three"),
      ],
    );
    expect(fallbacks).toEqual([]);
  });

  it("svg with viewBox and className", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Chart() {
        const [size, setSize] = useState(10);
        return (
          <div>
            <button id="grow" onClick={() => setSize(size + 5)}>Grow</button>
            <svg viewBox="0 0 100 100" className="chart" width="100" height="100">
              <circle cx="50" cy="50" r={size} fill="red" />
            </svg>
          </div>
        );
      }`,
      "Chart",
      [click("#grow"), click("#grow")],
    );
    expect(fallbacks).toEqual([]);
  });

  it("keyboard, focus and blur handlers", async () => {
    const fallbacks = await expectParity(
      `import { useState } from "react";
      export function Keys() {
        const [log, setLog] = useState("");
        return (
          <div onFocus={() => setLog(log + "f")} onBlur={() => setLog(log + "b")}>
            <input id="field" onKeyDown={(event) => setLog(log + event.key)} />
            <p>{log}</p>
          </div>
        );
      }`,
      "Keys",
      [
        (root) => root.querySelector<HTMLInputElement>("#field")!.focus(),
        (root) =>
          root
            .querySelector("#field")!
            .dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true })),
        (root) => root.querySelector<HTMLInputElement>("#field")!.blur(),
      ],
    );
    expect(fallbacks).toEqual([]);
  });
});
