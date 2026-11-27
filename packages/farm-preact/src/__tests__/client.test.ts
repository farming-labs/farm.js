// @vitest-environment jsdom

import { testClient } from "@farm.js/renderer-tests";
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import * as clientRuntime from "../client";
import * as serverRuntime from "../server";

testClient({
  reconcilesRerenders: true,
  name: "preact",
  client: clientRuntime,
  server: serverRuntime,
});

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("preact roots", () => {
  it("renders a new root in place of the markup a throwing hydration left", async () => {
    // Farm's development entry does this when hydrateRoot() throws, and so does a production entry
    // for a renderer that sets capabilities.hydrationFallback.
    let browserRenders = 0;
    function Counter() {
      const [count, setCount] = useState(0);
      if (browserRenders++ === 0) throw new Error("The first browser render threw.");
      return clientRuntime.createElement(
        "button",
        { onClick: () => setCount((n: number) => n + 1) },
        `Clicked ${count} times`,
      );
    }
    const tree = () =>
      clientRuntime.createElement("main", null, clientRuntime.createElement(Counter, null));
    const container = document.createElement("div");
    container.innerHTML = "<main><button>Clicked 0 times</button></main>";
    document.body.append(container);

    expect(() => clientRuntime.hydrateRoot(container, tree())).toThrow(
      "The first browser render threw.",
    );
    const root = clientRuntime.createRoot(container);
    root.render(tree());

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    container.querySelector("button")!.click();
    await nextTask();
    expect(container.textContent).toBe("Clicked 1 times");

    root.unmount();
    container.remove();
  });
});
