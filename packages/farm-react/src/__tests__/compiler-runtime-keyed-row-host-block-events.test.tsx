import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadCompiledAndOriginal,
  normalizedDom,
  removeCompiledModules,
} from "./compiled-module-harness";

// Keyed rows whose conditional content compiler-owned host blocks render delegate their row
// events to the rows container. Each scenario renders the source with React and the compiled
// output with React DOM, then compares the DOM after every interaction.

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

async function expectParity(
  source: string,
  name: string,
  steps: readonly Step[],
  ...expectedCode: string[]
) {
  const { compiled, original, names, code } = await loadCompiledAndOriginal(source);
  expect(names, "the scenario must compile").toContain(name);
  for (const expected of expectedCode) expect(code).toContain(expected);
  expect(code).toContain("farmBlocks.KeyedRows");
  expect(code).toContain("hostBlocks={true}");
  expect(code).toContain("delegateEvents={true}");
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

describe("row events beside compiler-owned row conditionals", () => {
  it("run for first-render, added and reordered rows with their current item", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Todos() {
        const [todos, setTodos] = useState([{ id: "a", done: false }, { id: "b", done: true }]);
        const [log, setLog] = useState("");
        return (
          <section>
            <ul>
              {todos.map((todo) => (
                <li key={todo.id} data-id={todo.id}>
                  <button className="toggle" onClick={() => {
                    setTodos(todos.map((item) => item.id === todo.id ? { ...item, done: !item.done } : item));
                    setLog(log + "|" + todo.id);
                  }}>toggle</button>
                  {todo.done ? <s>{todo.id}</s> : <i>{todo.id}</i>}
                </li>
              ))}
            </ul>
            <button id="add" onClick={() => setTodos([...todos, { id: "n" + todos.length, done: false }])}>Add</button>
            <button id="reverse" onClick={() => setTodos([...todos].reverse())}>Reverse</button>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Todos",
      [
        click('[data-id="a"] .toggle'),
        click('[data-id="b"] .toggle'),
        click("#add"),
        click('[data-id="n2"] .toggle'),
        click("#reverse"),
        click('[data-id="a"] .toggle'),
        click('[data-id="n2"] .toggle'),
      ],
    );
  });

  it("run nested handlers innermost first and stop at stopPropagation", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Cards() {
        const [cards, setCards] = useState([{ id: "a", open: false }, { id: "b", open: true }]);
        const [log, setLog] = useState("");
        return (
          <section>
            <ul>
              {cards.map((card) => (
                <li key={card.id} data-id={card.id} onClick={() => setLog(log + "|row:" + card.id)}>
                  <span className="name" onClick={() => setLog(log + "|name:" + card.id)}>{card.id}</span>
                  <button className="remove" onClick={(event) => {
                    event.stopPropagation();
                    setCards(cards.filter((item) => item.id !== card.id));
                  }}>x</button>
                  {card.open ? <em className="body">open</em> : null}
                </li>
              ))}
            </ul>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Cards",
      [
        click('[data-id="a"] .name'),
        click('[data-id="b"] .body'),
        click('[data-id="b"] .remove'),
        click('[data-id="a"] .name'),
      ],
    );
  });

  it("run on deeply nested static elements and beside a nested conditional container", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Inbox() {
        const [mails, setMails] = useState([{ id: "a", read: false, starred: false }]);
        return (
          <section>
            <ol>
              {mails.map((mail) => (
                <li key={mail.id} data-id={mail.id}>
                  <div className="row">
                    <label>
                      <input type="checkbox" readOnly checked={mail.read} onClick={() =>
                        setMails(mails.map((item) => item.id === mail.id ? { ...item, read: !item.read } : item))} />
                    </label>
                  </div>
                  <button className="star" onClick={() =>
                    setMails(mails.map((item) => item.id === mail.id ? { ...item, starred: !item.starred } : item))}>star</button>
                  <div className="flags">{mail.starred && <b>starred</b>}</div>
                  {mail.read ? <span>read</span> : <strong>unread</strong>}
                </li>
              ))}
            </ol>
            <button id="add" onClick={() => setMails([...mails, { id: "m" + mails.length, read: false, starred: true }])}>Add</button>
          </section>
        );
      }`,
      "Inbox",
      [
        click('[data-id="a"] input'),
        click('[data-id="a"] .star'),
        click("#add"),
        click('[data-id="m1"] input'),
        click('[data-id="m1"] .star'),
        click('[data-id="a"] input'),
      ],
    );
  });

  it("run with the current item after a hinted filter removes rows", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Rows() {
        const [rows, setRows] = useState([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
        const [selected, setSelected] = useState("a");
        return (
          <main>
            <button id="remove" onClick={() => setRows((current) => current.filter((row) => row.id !== selected))}>Remove</button>
            <ul>
              {rows.map((row) => (
                <li key={row.id} data-id={row.id} data-selected={selected === row.id}>
                  <button onClick={() => setSelected(row.id)}>Select</button>
                  {selected === row.id ? <b>selected</b> : null}
                </li>
              ))}
            </ul>
          </main>
        );
      }`,
      "Rows",
      [
        click('[data-id="b"] button'),
        click("#remove"),
        click('[data-id="c"] button'),
        click("#remove"),
        click('[data-id="d"] button'),
        click('[data-id="a"] button'),
        click("#remove"),
        click('[data-id="d"] button'),
      ],
      "filterIndexIndependent",
    );
  });

  it("keep working after duplicate keys hand the rows to React", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expectParity(
        `import { useState } from "react";
        export function Tags() {
          const [tags, setTags] = useState([{ id: "x", on: false }, { id: "y", on: true }]);
          const [log, setLog] = useState("");
          return (
            <section>
              <ul>
                {tags.map((tag) => (
                  <li key={tag.id} className={"tag " + tag.id}>
                    <button onClick={() => setLog(log + "|" + tag.id)}>{tag.id}</button>
                    {tag.on ? <b>on</b> : <i>off</i>}
                  </li>
                ))}
              </ul>
              <button id="dupe" onClick={() => setTags([{ id: "x", on: true }, { id: "x", on: false }])}>Dupe</button>
              <button id="reset" onClick={() => setTags([{ id: "x", on: false }, { id: "z", on: true }])}>Reset</button>
              <p id="log">{log}</p>
            </section>
          );
        }`,
        "Tags",
        [
          click(".tag.y button"),
          click("#dupe"),
          click(".tag.x button"),
          click("#reset"),
          click(".tag.z button"),
        ],
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe("row events inside compiler-owned row branches", () => {
  it("run from first-render, toggled, added and reordered rows with their current item", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Todos() {
        const [todos, setTodos] = useState([{ id: "a", done: false }, { id: "b", done: true }]);
        const [log, setLog] = useState("");
        const toggle = (id) => setTodos(todos.map((item) => item.id === id ? { ...item, done: !item.done } : item));
        return (
          <section>
            <ul>
              {todos.map((todo) => (
                <li key={todo.id} data-id={todo.id}>
                  {todo.done ? (
                    <s className="undo" onClick={() => { toggle(todo.id); setLog((current) => current + "|undo:" + todo.id); }}>{todo.id}</s>
                  ) : (
                    <button className="done" onClick={() => { toggle(todo.id); setLog((current) => current + "|done:" + todo.id); }}>{todo.id}</button>
                  )}
                </li>
              ))}
            </ul>
            <button id="add" onClick={() => setTodos([...todos, { id: "n" + todos.length, done: false }])}>Add</button>
            <button id="reverse" onClick={() => setTodos([...todos].reverse())}>Reverse</button>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Todos",
      [
        click('[data-id="a"] .done'),
        click('[data-id="a"] .undo'),
        click('[data-id="b"] .undo'),
        click("#add"),
        click('[data-id="n2"] .done'),
        click("#reverse"),
        click('[data-id="n2"] .undo'),
        click('[data-id="a"] .done'),
      ],
      "events: [0]",
      "events: [1]",
    );
  });

  it("run innermost first through branches, nested branches and capture handlers", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Cards() {
        const [cards, setCards] = useState([{ id: "a", open: true, pinned: true }, { id: "b", open: false, pinned: false }]);
        const [log, setLog] = useState("");
        const patch = (id, change) => setCards(cards.map((card) => card.id === id ? { ...card, ...change } : card));
        return (
          <section>
            <ul>
              {cards.map((card) => (
                <li key={card.id} data-id={card.id}
                  onClick={() => setLog((current) => current + "|row:" + card.id)}
                  onClickCapture={() => setLog((current) => current + "|row-capture:" + card.id)}>
                  <span>{card.id}</span>
                  {card.open ? (
                    <div className="body" onClick={() => setLog((current) => current + "|body:" + card.id)}>
                      <button className="close" onClick={(event) => { event.stopPropagation(); patch(card.id, { open: false }); }}>close</button>
                      <em className="note" onClickCapture={() => setLog((current) => current + "|note-capture:" + card.id)}>note</em>
                      <p>{card.pinned ? <b className="unpin" onClick={() => patch(card.id, { pinned: false })}>pinned</b> : <i className="pin" onClick={() => patch(card.id, { pinned: true })}>loose</i>}</p>
                    </div>
                  ) : (
                    <button className="open" onClick={() => patch(card.id, { open: true })}>open</button>
                  )}
                  {card.pinned && <small className="flag" onClick={() => setLog((current) => current + "|flag:" + card.id)}>flag</small>}
                </li>
              ))}
            </ul>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Cards",
      [
        click('[data-id="a"] .note'),
        click('[data-id="a"] .unpin'),
        click('[data-id="a"] .pin'),
        click('[data-id="a"] .flag'),
        click('[data-id="a"] .close'),
        click('[data-id="b"] .open'),
        click('[data-id="b"] .pin'),
        click('[data-id="b"] .note'),
        click('[data-id="b"] .flag'),
      ],
    );
  });

  it("keep working after duplicate keys hand the rows to React", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expectParity(
        `import { useState } from "react";
        export function Tags() {
          const [tags, setTags] = useState([{ id: "x", on: false }, { id: "y", on: true }]);
          const [log, setLog] = useState("");
          return (
            <section>
              <ul>
                {tags.map((tag) => (
                  <li key={tag.id} className={"tag " + tag.id}>
                    {tag.on ? <b onClick={() => setLog((current) => current + "|on:" + tag.id)}>on</b> : <i onClick={() => setLog((current) => current + "|off:" + tag.id)}>off</i>}
                  </li>
                ))}
              </ul>
              <button id="dupe" onClick={() => setTags([{ id: "x", on: true }, { id: "x", on: false }])}>Dupe</button>
              <button id="reset" onClick={() => setTags([{ id: "x", on: false }, { id: "z", on: true }])}>Reset</button>
              <p id="log">{log}</p>
            </section>
          );
        }`,
        "Tags",
        [
          click(".tag.y b"),
          click(".tag.x i"),
          click("#dupe"),
          click(".tag.x b"),
          click("#reset"),
          click(".tag.z b"),
          click(".tag.x i"),
        ],
      );
    } finally {
      error.mockRestore();
    }
  });

  it("run on elements after a conditional, a nested list and a public List", async () => {
    await expectParity(
      `import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Rows() {
        const [rows, setRows] = useState([{ id: "a", done: false, tags: ["x"] }, { id: "b", done: true, tags: [] }]);
        const [log, setLog] = useState("");
        const patch = (id, change) => setRows(rows.map((row) => row.id === id ? { ...row, ...change } : row));
        return (
          <section>
            <ul>
              {rows.map((row) => (
                <li key={row.id} data-id={row.id}>
                  <div className="after-conditional">
                    {row.done ? <s>done</s> : <i>open</i>}
                    <button className="toggle" onClick={() => patch(row.id, { done: !row.done })}>toggle</button>
                  </div>
                  <div className="after-list">
                    {row.tags.map((tag) => <b key={tag}>{tag}</b>)}
                    <button className="tag" onClick={() => patch(row.id, { tags: [...row.tags, "t" + row.tags.length] })}>tag</button>
                  </div>
                  <div className="after-public-list">
                    <List each={row.tags} by={(tag) => tag}>{(tag) => <u>{tag}</u>}</List>
                    <button className="log" onClick={() => setLog((current) => current + "|" + row.id + ":" + row.tags.length)}>log</button>
                    {row.done ? <s>done</s> : <i>open</i>}
                  </div>
                </li>
              ))}
            </ul>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Rows",
      [
        click('[data-id="a"] .toggle'),
        click('[data-id="a"] .tag'),
        click('[data-id="a"] .log'),
        click('[data-id="b"] .tag'),
        click('[data-id="b"] .tag'),
        click('[data-id="b"] .toggle'),
        click('[data-id="b"] .log'),
        click('[data-id="a"] .toggle'),
        click('[data-id="a"] .log'),
      ],
    );
  });
});
