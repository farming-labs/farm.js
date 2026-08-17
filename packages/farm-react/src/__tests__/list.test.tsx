import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { List } from "../list";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const roots: Array<{ unmount(): void }> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("List", () => {
  it("renders iterable values and preserves keyed child state across reorders", async () => {
    function Row({ name }: { name: string }) {
      const [clicks, setClicks] = useState(0);
      return (
        <button onClick={() => setClicks((value) => value + 1)}>
          {name}:{clicks}
        </button>
      );
    }

    function Example() {
      const [items, setItems] = useState(
        new Set([
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ]),
      );
      return (
        <section>
          <button data-action="reverse" onClick={() => setItems(new Set([...items].reverse()))}>
            Reverse
          </button>
          <List each={items} by={(item) => item.id}>
            {(item) => <Row name={item.name} />}
          </List>
        </section>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Example />));

    const rowButtons = () => [...container.querySelectorAll("button:not([data-action])")];
    await act(async () =>
      rowButtons()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(rowButtons().map((button) => button.textContent)).toEqual(["Alpha:1", "Beta:0"]);

    await act(async () =>
      container
        .querySelector<HTMLElement>("[data-action='reverse']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(rowButtons().map((button) => button.textContent)).toEqual(["Beta:0", "Alpha:1"]);
  });

  it("treats nullish collections as empty", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <ul>
          <List each={null} by={(item: string) => item}>
            {(item) => <li>{item}</li>}
          </List>
        </ul>,
      ),
    );
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
