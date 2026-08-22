import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const reactVersion = process.argv[2];
if (!reactVersion || !/^\d+\.\d+\.\d+/.test(reactVersion)) {
  throw new TypeError("Usage: node scripts/test-react-version.mjs <react-version>");
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), `farm-react-${reactVersion}-`));

const testSource = String.raw`
  import assert from "node:assert/strict";
  import { JSDOM } from "jsdom";

  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.HTMLOptionElement = dom.window.HTMLOptionElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;

  const React = (await import("react")).default;
  const { flushSync } = await import("react-dom");
  const { createRoot, hydrateRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");
  const { createCompiledComponent } = await import("@farm.js/react/compiler-runtime");
  const { List } = await import("@farm.js/react/list");

  const Counter = createCompiledComponent({
    displayName: "CompatibilityCounter",
    initialize: () => [0],
    render(_props, state) {
      return React.createElement(
        "button",
        { onClick: () => state[0].set((value) => Number(value) + 1) },
        "Count: ",
        Number(state[0].get()),
      );
    },
    bindings: [
      {
        kind: "text",
        path: [],
        dependencies: [0],
        read: (_props, state) => ["Count: ", state[0].get()],
      },
    ],
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(Counter)));
  container.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(container.textContent, "Count: 1");
  flushSync(() => root.unmount());

  const StaticBindings = createCompiledComponent({
    displayName: "CompatibilityStaticBindings",
    initialize: () => [8, "draft", "safe", true],
    render(_props, state) {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          {
            onClick: () => {
              state[0].set(24);
              state[1].set("compiled");
              state[2].set("fast");
              state[3].set(false);
            },
          },
          "Update bindings",
        ),
        React.createElement("div", { "data-bar": true, style: { width: 8 } }),
        React.createElement("textarea", {
          "aria-label": "Note",
          onChange: () => {},
          value: state[1].get(),
        }),
        React.createElement(
          "select",
          { "aria-label": "Mode", onChange: () => {}, value: state[2].get() },
          React.createElement("option", { value: "safe" }, "Safe"),
          React.createElement("option", { value: "fast" }, "Fast"),
        ),
        React.createElement("input", {
          "aria-label": "Enabled",
          checked: state[3].get(),
          readOnly: true,
          type: "checkbox",
        }),
      );
    },
    bindings: [
      {
        kind: "style",
        path: [1],
        dependencies: [0],
        name: "width",
        read: (_props, state) => state[0].get(),
      },
      {
        kind: "attribute",
        path: [2],
        dependencies: [1],
        name: "value",
        read: (_props, state) => state[1].get(),
      },
      {
        kind: "attribute",
        path: [3],
        dependencies: [2],
        name: "value",
        read: (_props, state) => state[2].get(),
      },
      {
        kind: "attribute",
        path: [4],
        dependencies: [3],
        name: "checked",
        read: (_props, state) => state[3].get(),
      },
    ],
  });

  const staticContainer = document.createElement("div");
  document.body.append(staticContainer);
  const staticRoot = createRoot(staticContainer);
  flushSync(() => staticRoot.render(React.createElement(StaticBindings)));
  const textarea = staticContainer.querySelector("textarea");
  textarea.focus();
  textarea.setSelectionRange(1, 3);
  staticContainer.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(staticContainer.querySelector("[data-bar]").style.width, "24px");
  assert.equal(textarea.value, "compiled");
  assert.equal(textarea.selectionStart, 1);
  assert.equal(textarea.selectionEnd, 3);
  assert.equal(staticContainer.querySelector("select").value, "fast");
  assert.equal(staticContainer.querySelector('input[type="checkbox"]').checked, false);
  flushSync(() => staticRoot.unmount());

  let conditionalExecutions = 0;
  const ConditionalBlocks = createCompiledComponent({
    displayName: "CompatibilityConditionalBlocks",
    initialize: () => [false, 0],
    render(_props, state, blocks) {
      conditionalExecutions += 1;
      return React.createElement(
        "section",
        null,
        React.createElement(
          "button",
          { onClick: () => state[0].set((value) => !value) },
          "Toggle branch",
        ),
        React.createElement(blocks.Conditional, {
          id: 0,
          render: () =>
            state[0].get()
              ? React.createElement(
                  "strong",
                  { "data-branch": "enabled" },
                  "Enabled ",
                  state[1].get(),
                )
              : React.createElement(
                  "span",
                  { "data-branch": "disabled" },
                  "Disabled ",
                  state[1].get(),
                ),
        }),
        React.createElement("output", null, state[1].get()),
        React.createElement(
          "button",
          { onClick: () => state[1].set((value) => Number(value) + 1) },
          "Increment",
        ),
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0, 1] },
      {
        kind: "text",
        path: [1],
        dependencies: [1],
        read: (_props, state) => state[1].get(),
      },
    ],
  });

  const conditionalContainer = document.createElement("div");
  document.body.append(conditionalContainer);
  const conditionalRoot = createRoot(conditionalContainer);
  flushSync(() => conditionalRoot.render(React.createElement(ConditionalBlocks)));
  const initialConditionalExecutions = conditionalExecutions;
  conditionalContainer.querySelectorAll("button")[0].click();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  assert.equal(
    conditionalContainer.querySelector("[data-branch='enabled']").textContent,
    "Enabled 0",
  );
  conditionalContainer.querySelectorAll("button")[1].click();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  assert.equal(
    conditionalContainer.querySelector("[data-branch='enabled']").textContent,
    "Enabled 1",
  );
  assert.equal(conditionalContainer.querySelector("output").textContent, "1");
  assert.equal(conditionalExecutions, initialConditionalExecutions);
  flushSync(() => conditionalRoot.unmount());

  let hostConditionalExecutions = 0;
  const HostConditionalBlocks = createCompiledComponent({
    displayName: "CompatibilityHostConditionalBlocks",
    initialize: () => [true, 0],
    render(_props, state, blocks) {
      hostConditionalExecutions += 1;
      return React.createElement(
        "section",
        null,
        React.createElement(
          "button",
          { "data-increment": true, onClick: () => state[1].set((value) => Number(value) + 1) },
          "Increment branch",
        ),
        React.createElement(
          "button",
          { "data-toggle": true, onClick: () => state[0].set((value) => !value) },
          "Toggle branch",
        ),
        React.createElement(blocks.HostConditional, {
          id: 0,
          render: () =>
            React.createElement(
              "div",
              { "data-slot": true },
              state[0].get()
                ? React.createElement("strong", { "data-branch": "enabled" }, "Enabled ", state[1].get())
                : React.createElement("span", { "data-branch": "disabled" }, "Disabled ", state[1].get()),
            ),
          test: () => state[0].get(),
          truthy: {
            create: () => ({
              kind: "element",
              tag: "strong",
              attributes: [{ name: "data-branch", value: "enabled" }],
              styles: [],
              children: [["Enabled ", state[1].get()]],
            }),
            bindings: [{ kind: "text", path: [], read: () => ["Enabled ", state[1].get()] }],
          },
          falsy: {
            create: () => ({
              kind: "element",
              tag: "span",
              attributes: [{ name: "data-branch", value: "disabled" }],
              styles: [],
              children: [["Disabled ", state[1].get()]],
            }),
            bindings: [{ kind: "text", path: [], read: () => ["Disabled ", state[1].get()] }],
          },
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
  });
  const hostConditionalContainer = document.createElement("div");
  document.body.append(hostConditionalContainer);
  const hostConditionalRoot = createRoot(hostConditionalContainer);
  flushSync(() => hostConditionalRoot.render(React.createElement(HostConditionalBlocks)));
  const initialHostConditionalExecutions = hostConditionalExecutions;
  const initialHostBranch = hostConditionalContainer.querySelector("[data-branch='enabled']");
  hostConditionalContainer.querySelector("[data-increment]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hostConditionalContainer.querySelector("[data-branch='enabled']"), initialHostBranch);
  assert.equal(initialHostBranch.textContent, "Enabled 1");
  hostConditionalContainer.querySelector("[data-toggle]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    hostConditionalContainer.querySelector("[data-branch='disabled']").textContent,
    "Disabled 1",
  );
  assert.equal(hostConditionalExecutions, initialHostConditionalExecutions);
  flushSync(() => hostConditionalRoot.unmount());

  const explicitListContainer = document.createElement("div");
  document.body.append(explicitListContainer);
  const explicitListRoot = createRoot(explicitListContainer);
  flushSync(() =>
    explicitListRoot.render(
      React.createElement(
        "ul",
        null,
        React.createElement(List, {
          each: [{ id: "a", label: "Alpha" }],
          by: (item) => item.id,
          children: (item) => React.createElement("li", null, item.label),
        }),
      ),
    ),
  );
  assert.equal(explicitListContainer.textContent, "Alpha");
  flushSync(() => explicitListRoot.unmount());

  let keyedExecutions = 0;
  const KeyedBlocks = createCompiledComponent({
    displayName: "CompatibilityKeyedBlocks",
    initialize: () => [[{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }]],
    render(_props, state, blocks) {
      keyedExecutions += 1;
      return React.createElement(
        "section",
        null,
        React.createElement(
          "button",
          { onClick: () => state[0].set((value) => [...value].reverse()) },
          "Reverse",
        ),
        React.createElement(
          "ul",
          null,
          React.createElement(blocks.KeyedList, {
            id: 0,
            render: () =>
              state[0].get().map((item) =>
                React.createElement("li", { key: item.id, "data-key": item.id }, item.label),
              ),
          }),
        ),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const keyedContainer = document.createElement("div");
  document.body.append(keyedContainer);
  const keyedRoot = createRoot(keyedContainer);
  flushSync(() => keyedRoot.render(React.createElement(KeyedBlocks)));
  const initialKeyedExecutions = keyedExecutions;
  const originalAlpha = keyedContainer.querySelector("[data-key='a']");
  keyedContainer.querySelector("button").click();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  assert.deepEqual(
    [...keyedContainer.querySelectorAll("li")].map((row) => row.getAttribute("data-key")),
    ["b", "a"],
  );
  assert.equal(keyedContainer.querySelector("[data-key='a']"), originalAlpha);
  assert.equal(keyedExecutions, initialKeyedExecutions);
  flushSync(() => keyedRoot.unmount());

  let keyedRowExecutions = 0;
  const KeyedRows = createCompiledComponent({
    displayName: "CompatibilityKeyedRows",
    initialize: () => [["a", "b", "c", "d"]],
    render(_props, state, blocks) {
      keyedRowExecutions += 1;
      const items = () => state[0].get();
      return React.createElement(
        "section",
        null,
        React.createElement(
          "button",
          { onClick: () => state[0].set((value) => [value[3], value[0], value[1], value[2]]) },
          "Rotate",
        ),
        React.createElement(blocks.KeyedRows, {
          id: 0,
          render: () =>
            React.createElement(
              "ol",
              null,
              items().map((item) =>
                React.createElement("li", { key: item, "data-key": item }, item.toUpperCase()),
              ),
            ),
          items,
          rowKey: (item) => item,
          create: (item) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item }],
            styles: [],
            children: [item.toUpperCase()],
          }),
          bindings: [
            { kind: "text", path: [], read: (item) => [item.toUpperCase()] },
          ],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const keyedRowsContainer = document.createElement("div");
  document.body.append(keyedRowsContainer);
  const keyedRowsRoot = createRoot(keyedRowsContainer);
  flushSync(() => keyedRowsRoot.render(React.createElement(KeyedRows)));
  const initialKeyedRowExecutions = keyedRowExecutions;
  const originalA = keyedRowsContainer.querySelector("[data-key='a']");
  const keyedRowsList = keyedRowsContainer.querySelector("ol");
  const originalInsertBefore = keyedRowsList.insertBefore.bind(keyedRowsList);
  let keyedRowMoves = 0;
  keyedRowsList.insertBefore = (node, anchor) => {
    if (node.parentNode === keyedRowsList) keyedRowMoves += 1;
    return originalInsertBefore(node, anchor);
  };
  keyedRowsContainer.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    [...keyedRowsContainer.querySelectorAll("li")].map((row) => row.getAttribute("data-key")),
    ["d", "a", "b", "c"],
  );
  assert.equal(keyedRowsContainer.querySelector("[data-key='a']"), originalA);
  assert.equal(keyedRowMoves, 1);
  assert.equal(keyedRowExecutions, initialKeyedRowExecutions);
  flushSync(() => keyedRowsRoot.unmount());

  let interactiveRowExecutions = 0;
  let interactiveListRenders = 0;
  let setInteractiveItems = () => undefined;
  const interactiveCalls = [];
  const InteractiveKeyedRows = createCompiledComponent({
    displayName: "CompatibilityInteractiveKeyedRows",
    initialize: () => [[
      { id: "a", label: "Alpha", done: false },
      { id: "b", label: "Beta", done: true },
    ]],
    render(_props, state, blocks) {
      interactiveRowExecutions += 1;
      setInteractiveItems = (next) => state[0].set(next);
      const items = () => state[0].get();
      return React.createElement(
        "section",
        null,
        React.createElement(blocks.KeyedRows, {
          id: 0,
          render: (rowEvent, rowConditional) => {
            interactiveListRenders += 1;
            return React.createElement(
              "ol",
              null,
              items().map((item, index) =>
                React.createElement(
                  "li",
                  { key: item.id, "data-key": item.id },
                  React.createElement("span", null, item.label),
                  React.createElement(
                    "div",
                    { "data-status": true },
                    rowConditional(item, index, 0, (current) =>
                      current.done
                        ? React.createElement("strong", null, current.label + " done")
                        : React.createElement("small", null, "Open"),
                    ),
                  ),
                  React.createElement(
                    "button",
                    {
                      "data-index": index,
                      onClick: rowEvent(item, index, 0),
                      type: "button",
                    },
                    "Update",
                  ),
                ),
              ),
            );
          },
          items,
          rowKey: (item) => item.id,
          create: (item, index) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item.id }],
            styles: [],
            children: [
              {
                kind: "element",
                tag: "span",
                attributes: [],
                styles: [],
                children: [item.label],
              },
              {
                kind: "element",
                tag: "div",
                attributes: [{ name: "data-status", value: true }],
                styles: [],
                children: [],
              },
              {
                kind: "element",
                tag: "button",
                attributes: [
                  { name: "data-index", value: index },
                  { name: "type", value: "button" },
                ],
                styles: [],
                children: ["Update"],
              },
            ],
          }),
          bindings: [
            { kind: "text", path: [0], read: (item) => [item.label] },
            { kind: "attribute", path: [2], name: "data-index", read: (_item, index) => index },
          ],
          conditionals: [
            {
              id: 0,
              path: [1],
              logical: false,
              test: (item) => item.done,
              truthy: {
                bindings: [
                  { kind: "text", path: [], read: (item) => [item.label] },
                ],
              },
              falsy: { bindings: [] },
            },
          ],
          events: [
            {
              name: "onClick",
              invoke: (item, index, event) => {
                interactiveCalls.push(item.label + ":" + index + ":" + event.currentTarget.dataset.index);
                state[0].set((current) =>
                  current.map((row) =>
                    row.id === item.id
                      ? { ...row, label: item.label + "!", done: !item.done }
                      : row,
                  ),
                );
              },
            },
          ],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });

  const interactiveContainer = document.createElement("div");
  document.body.append(interactiveContainer);
  const interactiveRoot = createRoot(interactiveContainer);
  flushSync(() => interactiveRoot.render(React.createElement(InteractiveKeyedRows)));
  const initialInteractiveExecutions = interactiveRowExecutions;
  const initialInteractiveRenders = interactiveListRenders;
  const interactiveAlpha = interactiveContainer.querySelector("[data-key='a']");
  interactiveAlpha.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(interactiveAlpha.querySelector("span").textContent, "Alpha!");
  assert.equal(interactiveAlpha.querySelector("[data-status]").textContent, "Alpha! done");
  assert.deepEqual(interactiveCalls, ["Alpha:0:0"]);
  assert.equal(interactiveRowExecutions, initialInteractiveExecutions);
  assert.equal(interactiveListRenders, initialInteractiveRenders);

  const interactiveStateButton = interactiveAlpha.querySelector("button");
  interactiveStateButton.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(interactiveAlpha.querySelector("span").textContent, "Alpha!!");
  assert.equal(interactiveAlpha.querySelector("[data-status]").textContent, "Open");
  assert.deepEqual(interactiveCalls, ["Alpha:0:0", "Alpha!:0:0"]);
  assert.equal(interactiveContainer.querySelector("[data-key='a']"), interactiveAlpha);

  setInteractiveItems((current) => [...current].reverse());
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  assert.deepEqual(
    [...interactiveContainer.querySelectorAll("li")].map((row) => row.getAttribute("data-key")),
    ["b", "a"],
  );
  assert.equal(interactiveContainer.querySelector("[data-key='a']"), interactiveAlpha);
  assert.equal(interactiveListRenders, initialInteractiveRenders + 1);
  interactiveAlpha.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(interactiveAlpha.querySelector("span").textContent, "Alpha!!!");
  assert.equal(interactiveAlpha.querySelector("[data-status]").textContent, "Alpha!!! done");
  assert.deepEqual(interactiveCalls, ["Alpha:0:0", "Alpha!:0:0", "Alpha!!:1:1"]);
  flushSync(() => interactiveRoot.unmount());

  const interactiveHydrationContainer = document.createElement("div");
  interactiveHydrationContainer.innerHTML = renderToString(
    React.createElement(InteractiveKeyedRows),
  );
  document.body.append(interactiveHydrationContainer);
  const hydratedInteractiveAlpha = interactiveHydrationContainer.querySelector("[data-key='a']");
  const interactiveHydrationRoot = hydrateRoot(
    interactiveHydrationContainer,
    React.createElement(InteractiveKeyedRows),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    interactiveHydrationContainer.querySelector("[data-key='a']"),
    hydratedInteractiveAlpha,
  );
  hydratedInteractiveAlpha.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hydratedInteractiveAlpha.querySelector("span").textContent, "Alpha!");
  assert.equal(
    hydratedInteractiveAlpha.querySelector("[data-status]").textContent,
    "Alpha! done",
  );
  flushSync(() => interactiveHydrationRoot.unmount());

  let derivedCollectionExecutions = 0;
  const DerivedCollections = createCompiledComponent({
    displayName: "CompatibilityDerivedCollections",
    initialize: () => [
      [
        { id: "a", label: "Alpha", rank: 1, visible: true },
        { id: "b", label: "Beta", rank: 3, visible: true },
        { id: "c", label: "Gamma", rank: 2, visible: false },
      ],
      0,
    ],
    render(_props, state, blocks) {
      derivedCollectionExecutions += 1;
      const items = () =>
        state[0]
          .get()
          .filter((item) => item.visible && item.rank >= Number(state[1].get()))
          .toSorted((left, right) => left.rank - right.rank)
          .slice(0, 2)
          .toReversed();
      return React.createElement(
        "section",
        null,
        React.createElement(
          "button",
          {
            onClick: () => {
              state[0].set((value) =>
                value.map((item) =>
                  item.id === "b" ? { ...item, label: "Bravo", rank: 4 } : item,
                ),
              );
              state[1].set(2);
            },
          },
          "Update pipeline",
        ),
        React.createElement(blocks.KeyedRows, {
          id: 0,
          render: () =>
            React.createElement(
              "ol",
              null,
              items().map((item) =>
                React.createElement("li", { key: item.id, "data-key": item.id }, item.label),
              ),
            ),
          items,
          rowKey: (item) => item.id,
          create: (item) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item.id }],
            styles: [],
            children: [item.label],
          }),
          bindings: [{ kind: "text", path: [], read: (item) => [item.label] }],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
  });
  const derivedCollectionContainer = document.createElement("div");
  document.body.append(derivedCollectionContainer);
  const derivedCollectionRoot = createRoot(derivedCollectionContainer);
  flushSync(() => derivedCollectionRoot.render(React.createElement(DerivedCollections)));
  const initialDerivedCollectionExecutions = derivedCollectionExecutions;
  const originalBeta = derivedCollectionContainer.querySelector("[data-key='b']");
  derivedCollectionContainer.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    [...derivedCollectionContainer.querySelectorAll("li")].map((row) => [
      row.getAttribute("data-key"),
      row.textContent,
    ]),
    [["b", "Bravo"]],
  );
  assert.equal(derivedCollectionContainer.querySelector("[data-key='b']"), originalBeta);
  assert.equal(derivedCollectionExecutions, initialDerivedCollectionExecutions);
  flushSync(() => derivedCollectionRoot.unmount());

  let islandExecutions = 0;
  let islandChildExecutions = 0;
  function IslandChild({ value }) {
    islandChildExecutions += 1;
    const [selected, setSelected] = React.useState(false);
    return React.createElement(
      "button",
      { "data-island": true, onClick: () => setSelected((current) => !current) },
      value,
      ":",
      selected ? "selected" : "idle",
    );
  }
  const ComponentIslands = createCompiledComponent({
    displayName: "CompatibilityComponentIslands",
    initialize: () => [0],
    render(_props, state, blocks) {
      islandExecutions += 1;
      return React.createElement(
        "section",
        null,
        React.createElement(
          "button",
          { "data-update": true, onClick: () => state[0].set((value) => Number(value) + 1) },
          "Update",
        ),
        React.createElement(
          "output",
          { ref: blocks.target(0) },
          Number(state[0].get()),
        ),
        React.createElement(blocks.Component, {
          id: 0,
          render: () => React.createElement(IslandChild, { value: Number(state[0].get()) }),
        }),
      );
    },
    bindings: [
      {
        kind: "text",
        path: [1],
        target: 0,
        dependencies: [0],
        read: (_props, state) => state[0].get(),
      },
      { kind: "block", id: 0, dependencies: [0] },
    ],
  });
  const islandContainer = document.createElement("div");
  document.body.append(islandContainer);
  const islandRoot = createRoot(islandContainer);
  flushSync(() => islandRoot.render(React.createElement(ComponentIslands)));
  islandContainer.querySelector("[data-island]").click();
  flushSync(() => {});
  islandContainer.querySelector("[data-update]").click();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  assert.equal(islandContainer.querySelector("output").textContent, "1");
  assert.equal(islandContainer.querySelector("[data-island]").textContent, "1:selected");
  assert.equal(islandExecutions, 1);
  assert.equal(islandChildExecutions, 3);
  flushSync(() => islandRoot.unmount());

  const hydrationContainer = document.createElement("div");
  hydrationContainer.innerHTML = renderToString(React.createElement(Counter));
  document.body.append(hydrationContainer);
  const hydrationRoot = hydrateRoot(hydrationContainer, React.createElement(Counter));
  await new Promise((resolve) => setTimeout(resolve, 0));
  hydrationContainer.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hydrationContainer.textContent, "Count: 1");
  flushSync(() => hydrationRoot.unmount());

  assert.equal(React.version.startsWith(${JSON.stringify(reactVersion.split(".", 1)[0])}), true);
  console.log("@farm.js/react compatibility passed with React " + React.version);
`;

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporaryRoot], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  const packageArchive = readdirSync(temporaryRoot).find((file) => file.endsWith(".tgz"));
  if (!packageArchive) throw new Error("pnpm pack did not produce an archive");

  writeFileSync(
    join(temporaryRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "farm-react-compatibility-test",
        private: true,
        type: "module",
        packageManager: "pnpm@8.12.1",
        dependencies: {
          "@farm.js/react": `file:${join(temporaryRoot, packageArchive)}`,
          jsdom: "25.0.1",
          react: reactVersion,
          "react-dom": reactVersion,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(temporaryRoot, "compatibility.mjs"), testSource);
  execFileSync(
    "pnpm",
    [
      "install",
      "--ignore-workspace",
      "--no-frozen-lockfile",
      "--ignore-scripts",
      "--config.auto-install-peers=false",
    ],
    {
      cwd: temporaryRoot,
      stdio: "inherit",
    },
  );
  execFileSync(process.execPath, ["compatibility.mjs"], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
