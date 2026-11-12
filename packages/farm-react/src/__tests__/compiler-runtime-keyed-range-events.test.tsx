import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

// Row events in a keyed list that shares its container with static siblings (keyed ranges) run
// through the container. Each scenario renders the source with React and the compiled output
// with React DOM, then compares the DOM after every interaction.

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

async function expectParity(source: string, name: string, steps: readonly Step[]) {
  const { compiled, original, names, code } = await loadCompiledAndOriginal(source);
  expect(names, "the scenario must compile").toContain(name);
  expect(code).toContain("farmBlocks.KeyedRanges");
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
  expect(hosts[1]!.host.innerHTML).toBe(hosts[0]!.host.innerHTML);
  for (const [index, step] of steps.entries()) {
    for (const { host } of hosts) await act(async () => step(host));
    expect(hosts[1]!.host.innerHTML, `after step ${index + 1}`).toBe(hosts[0]!.host.innerHTML);
  }
}

describe("row events in keyed ranges", () => {
  it("run for first-render rows, added rows and reordered rows with their current item", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Filters() {
        const [names, setNames] = useState(["all", "active"]);
        const [filter, setFilter] = useState("all");
        const [log, setLog] = useState("");
        return (
          <section>
            <nav>
              <b>Show</b>
              {names.map((name) => (
                <button key={name} data-name={name} className={filter === name ? "selected" : ""}
                  onClick={() => { setFilter(name); setLog(log + "|" + name); }}>{name}</button>
              ))}
              <button id="add" onClick={() => setNames([...names, "n" + names.length])}>Add</button>
              <button id="reverse" onClick={() => setNames([...names].reverse())}>Reverse</button>
            </nav>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Filters",
      [
        click('[data-name="active"]'),
        click("#add"),
        click('[data-name="n2"]'),
        click("#reverse"),
        click('[data-name="all"]'),
        click('[data-name="n2"]'),
      ],
    );
  });

  it("run nested handlers innermost first and stop at stopPropagation", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Cards() {
        const [cards, setCards] = useState([{ id: "a" }, { id: "b" }]);
        const [log, setLog] = useState("");
        return (
          <section>
            <ul>
              <li className="head">Cards</li>
              {cards.map((card) => (
                <li key={card.id} data-id={card.id} onClick={() => setLog(log + "|row:" + card.id)}>
                  <span className="name">{card.id}</span>
                  <button className="remove" onClick={(event) => {
                    event.stopPropagation();
                    setCards(cards.filter((item) => item.id !== card.id));
                    setLog(log + "|remove:" + card.id);
                  }}>x</button>
                </li>
              ))}
            </ul>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Cards",
      [click('[data-id="a"] .name'), click('[data-id="b"] .remove'), click('[data-id="a"] .name')],
    );
  });

  it("run in each of several ranges sharing one container", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Boards() {
        const [left, setLeft] = useState([1, 2]);
        const [right, setRight] = useState([3]);
        const [log, setLog] = useState("");
        return (
          <section>
            <div>
              {left.map((n) => <button key={n} data-left={n} onClick={() => setLog(log + "|L" + n)}>{n}</button>)}
              <hr />
              {right.map((n) => <button key={n} data-right={n} onClick={() => { setRight(right.filter((value) => value !== n)); setLeft([...left, n]); }}>{n}</button>)}
            </div>
            <p id="log">{log}</p>
          </section>
        );
      }`,
      "Boards",
      [click('[data-left="2"]'), click('[data-right="3"]'), click('[data-left="3"]')],
    );
  });

  it("keep working after duplicate keys hand the ranges to React", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expectParity(
        `import { useState } from "react";
        export function Tags() {
          const [tags, setTags] = useState(["x", "y"]);
          const [log, setLog] = useState("");
          return (
            <section>
              <div>
                <b>Tags</b>
                {tags.map((tag) => <button key={tag} className={"tag " + tag} onClick={() => setLog(log + "|" + tag)}>{tag}</button>)}
              </div>
              <button id="dupe" onClick={() => setTags(["x", "x"])}>Dupe</button>
              <button id="reset" onClick={() => setTags(["x", "z"])}>Reset</button>
              <p id="log">{log}</p>
            </section>
          );
        }`,
        "Tags",
        [click(".tag.y"), click("#dupe"), click(".tag.x"), click("#reset"), click(".tag.z")],
      );
    } finally {
      error.mockRestore();
    }
  });
});
