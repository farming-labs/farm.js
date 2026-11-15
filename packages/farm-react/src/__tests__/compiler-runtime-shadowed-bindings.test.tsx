import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
  var farmShadowGate: () => Promise<void>;
}

const roots: Root[] = [];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis, "farmShadowGate");
});
afterAll(removeCompiledModules);

describe.each(["static", "hybrid"] as const)("%s lexical compiler bindings", (reactivity) => {
  async function pair(source: string, hydrate = false, props = {}) {
    const { compiled, original, names, reasons } = await loadCompiledAndOriginal(
      source,
      reactivity,
    );
    expect(names).toEqual(["Counter"]);
    expect(reasons).toEqual([]);
    const elements = [original.Counter, compiled.Counter].map((Component) => (
      <StrictMode>
        <Component {...props} />
      </StrictMode>
    ));
    const html = elements.map((element) => renderToString(element));
    expect(html[1]).toBe(html[0]);
    const errors: unknown[] = [];
    const containers: HTMLElement[] = [];
    for (const [index, element] of elements.entries()) {
      const container = document.createElement("div");
      document.body.append(container);
      containers.push(container);
      await act(async () => {
        if (hydrate) {
          container.innerHTML = html[index];
          roots.push(
            hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) }),
          );
        } else {
          const root = createRoot(container);
          roots.push(root);
          root.render(element);
        }
      });
    }
    expect(errors).toEqual([]);
    expect(containers[1].innerHTML).toBe(containers[0].innerHTML);
    return containers;
  }

  async function click(containers: HTMLElement[], selector = "button") {
    for (const container of containers) {
      const button = container.querySelector<HTMLButtonElement>(selector)!;
      button.focus();
      await act(async () => button.click());
      expect(container.querySelector(selector)).toBe(button);
      expect(document.activeElement).toBe(button);
    }
    expect(containers[1].innerHTML).toBe(containers[0].innerHTML);
  }

  describe.each([false, true])("hydrate=%s", (hydrate) => {
    it.each(["count", "NaN", "Infinity", "undefined", "Math", "Map", "Date", "Array"])(
      "preserves state named %s in SSR, text, attributes, and event reads",
      async (name) => {
        const containers = await pair(
          `
          import { useState } from "react";
          export function Counter() {
            const [${name}, setValue] = useState(0);
            return <button data-count={${name}} onClick={() => setValue(${name} + 1)}>{${name}}</button>;
          }
        `,
          hydrate,
        );
        for (let count = 1; count <= 3; count++) {
          await click(containers);
          expect(containers[1].textContent).toBe(String(count));
        }
      },
    );

    it.each(["parseInt", "Map", "undefined"])("preserves a setter named %s", async (name) => {
      const containers = await pair(
        `
        import { useState } from "react";
        export function Counter() {
          const [count, ${name}] = useState(0);
          return <button onClick={() => { ${name}(value => value + 1); ${name}(value => value + 1); }}>{count}</button>;
        }
      `,
        hydrate,
      );
      await click(containers);
      expect(containers[1].textContent).toBe("2");
    });

    it("expands global-named derived values, props, and handlers without rewriting nested parameters", async () => {
      const containers = await pair(
        `
        import { useState } from "react";
        export function Counter({ Infinity }) {
          const [NaN, parseInt] = useState(0);
          const Math = NaN + Infinity;
          const Date = Math * 2;
          function Map(NaN) { parseInt(NaN.type.length); }
          return <button data-count={NaN} onClick={Map}>{Date}</button>;
        }
      `,
        hydrate,
        { Infinity: 3 },
      );
      expect(containers[1].textContent).toBe("6");
      await click(containers);
      expect(containers[1].textContent).toBe("16");
    });
  });

  it("preserves local setter shadowing and genuine globals", async () => {
    const containers = await pair(`
      import { useState } from "react";
      export function Counter() {
        const [count, parseInt] = useState(0);
        return <section>
          <output>{Math.max(count, 0)}:{typeof undefined}:{typeof Map}</output>
          <button id="local" onClick={() => {
            function parseInt(value) { return value + 10; }
            globalThis.farmShadowGate = () => Promise.resolve(parseInt(2));
          }}>Local</button>
          <button id="state" onClick={() => parseInt(count + 1)}>State</button>
        </section>;
      }
    `);
    await click(containers, "#local");
    expect(await globalThis.farmShadowGate()).toBe(12);
    await click(containers, "#state");
    expect(containers[1].querySelector("output")?.textContent).toBe("1:undefined:function");
  });

  it("snapshots global-named state and props before a deferred handler resumes", async () => {
    const gates: Array<() => void> = [];
    globalThis.farmShadowGate = () => new Promise<void>((resolve) => gates.push(resolve));
    const containers = await pair(
      `
      import { useState } from "react";
      export function Counter({ Infinity }) {
        const [NaN, parseInt] = useState(0);
        return <section>
          <output>{NaN}</output>
          <button id="later" onClick={async () => {
            await globalThis.farmShadowGate();
            parseInt(NaN + Infinity);
          }}>Later</button>
          <button id="now" onClick={() => parseInt(NaN + 1)}>Now</button>
        </section>;
      }
    `,
      true,
      { Infinity: 10 },
    );
    await click(containers, "#later");
    await click(containers, "#now");
    expect(gates).toHaveLength(2);
    await act(async () => {
      for (const resolve of gates) resolve();
    });
    expect(containers[1].innerHTML).toBe(containers[0].innerHTML);
    expect(containers[1].querySelector("output")?.textContent).toBe("10");
  });

  it("updates keyed rows with global-named state, setters, and callback parameters", async () => {
    const containers = await pair(
      `
      import { useState } from "react";
      export function Counter() {
        const [Date, parseInt] = useState([{ id: "a", value: 0 }, { id: "b", value: 1 }]);
        const [NaN, setSelected] = useState("a");
        return <section>
          <button id="update" onClick={() => parseInt(rows => rows.map(row => row.id === "a" ? { ...row, value: row.value + 1 } : row))}>Update</button>
          <button id="select" onClick={() => setSelected("b")}>Select</button>
          <ul>{Date.map(Math => <li key={Math.id} data-active={NaN === Math.id}>{Math.value}</li>)}</ul>
        </section>;
      }
    `,
      true,
    );
    const before = containers[1].querySelectorAll("li");
    await click(containers, "#update");
    await click(containers, "#select");
    expect([...containers[1].querySelectorAll("li")]).toEqual([...before]);
    expect([...before].map((row) => row.textContent)).toEqual(["1", "1"]);
    expect(before[1].getAttribute("data-active")).toBe("true");
  });
});
