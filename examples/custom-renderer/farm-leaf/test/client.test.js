// @vitest-environment jsdom

import { testClient } from "@farm.js/renderer-tests";
import { createElement, useEffect, useState } from "leaf";
import { createRoot, hydrateRoot } from "leaf/dom";
import { renderToString } from "leaf/server";
import { describe, expect, it } from "vitest";
import * as client from "../src/client.js";
import * as server from "../src/server.js";

testClient({
  name: "leaf",
  client,
  server,
  reconcilesRerenders: true,
});

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("leaf in the browser", () => {
  it("hydrates adjacent strings the server wrote as one text node", async () => {
    function Counter() {
      const [count, setCount] = useState(0);
      return createElement(
        "button",
        { onClick: () => setCount((n) => n + 1) },
        "Clicked ",
        count,
        " times",
      );
    }
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(Counter, null));
    const button = container.firstElementChild;
    hydrateRoot(container, createElement(Counter, null));

    button.click();
    await nextTask();
    expect(container.firstElementChild).toBe(button);
    expect(button.textContent).toBe("Clicked 1 times");
  });

  it("runs effects after commit and their cleanup on unmount", async () => {
    const log = [];
    function Effect() {
      useEffect(() => {
        log.push("mounted");
        return () => log.push("cleaned up");
      }, []);
      return createElement("p", null, "effect");
    }
    const root = createRoot(document.createElement("div"));
    root.render(createElement(Effect, null));
    expect(log).toEqual(["mounted"]);
    root.unmount();
    expect(log).toEqual(["mounted", "cleaned up"]);
  });

  it("keeps a component's state when its parent re-renders it in place", async () => {
    let setLabel;
    function Child() {
      const [count, setCount] = useState(0);
      return createElement("button", { onClick: () => setCount((n) => n + 1) }, String(count));
    }
    function Parent() {
      const [label, update] = useState("a");
      setLabel = update;
      return createElement(
        "div",
        null,
        createElement("span", null, label),
        createElement(Child, null),
      );
    }
    const container = document.createElement("div");
    createRoot(container).render(createElement(Parent, null));
    container.querySelector("button").click();
    await nextTask();
    setLabel("b");
    await nextTask();
    expect(container.textContent).toBe("b1");
  });
});

describe("farm-leaf's client module", () => {
  it("renders a new root in place of the markup already in its container", () => {
    // Farm creates a root over the server's markup when hydrateRoot() throws.
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement("p", null, "Server markup"));
    client.createRoot(container).render(createElement("span", null, "Client render"));
    expect(container.innerHTML).toBe("<span>Client render</span>");
  });
});
