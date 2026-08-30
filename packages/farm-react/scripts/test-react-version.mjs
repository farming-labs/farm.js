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
  const {
    createCompiledComponent,
    createCompiledComponentWithFeatures,
    createCompilerKeyedArrayAppend,
    createCompilerKeyedArrayFilter,
    createCompilerKeyedArrayPositionUpdate,
    createCompilerKeyedArrayPrepend,
    createCompilerKeyedArrayReorder,
    createCompilerKeyedArraySort,
    createCompilerKeyedArraySlice,
    createCompilerKeyedMapUpdate,
  } = await import(
    "@farm.js/react/compiler-runtime"
  );
  const { List } = await import("@farm.js/react/list");

  const Counter = createCompiledComponentWithFeatures({
    displayName: "CompatibilityCounter",
    reactivity: "hybrid",
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
        tracking: "dynamic",
        path: [],
        dependencies: [0],
        read: (_props, state) => ["Count: ", state[0].get()],
      },
    ],
  }, []);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(Counter)));
  container.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(container.textContent, "Count: 1");
  flushSync(() => root.unmount());

  let reverseCompatibilityRows = () => undefined;
  let removeCompatibilityRow = () => undefined;
  let sortCompatibilityRows = () => undefined;
  let reorderExecutions = 0;
  const ReorderRows = createCompiledComponent({
    displayName: "CompatibilityReorderRows",
    initialize: () => [[
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ]],
    render(_props, state, blocks) {
      reorderExecutions += 1;
      const items = () => state[0].get();
      reverseCompatibilityRows = () =>
        state[0].set((previous) =>
          createCompilerKeyedArrayReorder(previous, previous.toReversed),
        );
      removeCompatibilityRow = () =>
        state[0].set((previous) =>
          createCompilerKeyedArrayPositionUpdate(
            previous,
            previous.toSpliced,
            "remove",
            1,
            1,
          ),
        );
      sortCompatibilityRows = () =>
        state[0].set((previous) =>
          createCompilerKeyedArraySort(
            previous,
            previous.toSorted,
            (left, right) => left.rank - right.rank,
          ),
        );
      return React.createElement(
        "section",
        null,
        React.createElement(blocks.KeyedRows, {
          collectionDependency: 0,
          dependencies: [0],
          id: 0,
          items,
          positionIndexIndependent: true,
          reorderIndexIndependent: true,
          structureDependencies: [0],
          render: () =>
            React.createElement(
              "ol",
              null,
              items().map((item) =>
                React.createElement("li", { key: item.id, "data-key": item.id }, item.label),
              ),
            ),
          rowKey: (item) => item.id,
          create: (item) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item.id }],
            styles: [],
            children: [item.label],
          }),
          bindings: [{ kind: "text", path: [], dependencies: [], read: (item) => [item.label] }],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const reorderContainer = document.createElement("div");
  document.body.append(reorderContainer);
  const reorderRoot = createRoot(reorderContainer);
  flushSync(() => reorderRoot.render(React.createElement(ReorderRows)));
  const reorderAlpha = reorderContainer.querySelector("[data-key='a']");
  const reorderGamma = reorderContainer.querySelector("[data-key='c']");
  reverseCompatibilityRows();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reorderContainer.querySelector("li:first-child"), reorderGamma);
  assert.equal(reorderContainer.querySelector("li:last-child"), reorderAlpha);
  assert.equal(reorderExecutions, 1);
  const reorderBeta = reorderContainer.querySelector("[data-key='b']");
  sortCompatibilityRows();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reorderContainer.querySelector("li:first-child"), reorderBeta);
  assert.equal(reorderContainer.querySelector("li:last-child"), reorderAlpha);
  assert.equal(reorderExecutions, 1);
  removeCompatibilityRow();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reorderContainer.querySelector("[data-key='c']"), null);
  assert.equal(reorderContainer.querySelector("li:first-child"), reorderBeta);
  assert.equal(reorderContainer.querySelector("li:last-child"), reorderAlpha);
  assert.equal(reorderExecutions, 1);
  flushSync(() => reorderRoot.unmount());

  const StaticBindings = createCompiledComponentWithFeatures({
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
  }, []);

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

  let recursiveHostExecutions = 0;
  const RecursiveHostBlocks = createCompiledComponent({
    displayName: "CompatibilityRecursiveHostBlocks",
    initialize: () => [true, false, [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }]],
    render(_props, state, blocks) {
      recursiveHostExecutions += 1;
      const readyBranch = {
        create: () => ({ kind: "element", tag: "strong", attributes: [], styles: [], children: ["Ready"] }),
        bindings: [],
      };
      const items = () => state[2].get();
      const outerBranch = {
        create: () => ({
          kind: "element",
          tag: "article",
          attributes: [],
          styles: [],
          children: [
            {
              kind: "element",
              tag: "div",
              attributes: [],
              styles: [],
              children: [state[1].get() ? readyBranch.create() : null],
              block: {
                kind: "conditional-ranges",
                id: 1,
                ranges: [{ before: 0, test: () => state[1].get(), logical: true, truthy: readyBranch }],
                trailing: 0,
              },
            },
            {
              kind: "element",
              tag: "ul",
              attributes: [],
              styles: [],
              children: [items().map((item) => ({ kind: "element", tag: "li", attributes: [{ name: "data-key", value: item.id }], styles: [], children: [item.label] }))],
              block: {
                kind: "keyed-ranges",
                id: 2,
                ranges: [{
                  before: 0,
                  items,
                  rowKey: (item) => item.id,
                  create: (item) => ({ kind: "element", tag: "li", attributes: [{ name: "data-key", value: item.id }], styles: [], children: [item.label] }),
                  bindings: [{ kind: "text", path: [], read: (item) => item.label }],
                }],
                trailing: 0,
              },
            },
          ],
        }),
        bindings: [],
      };
      return React.createElement(
        "section",
        null,
        React.createElement("button", {
          "data-recursive-update": true,
          onClick: () => {
            state[1].set((value) => !value);
            state[2].set((value) => [...value].reverse());
          },
        }, "Update recursive blocks"),
        React.createElement(blocks.HostConditional, {
          id: 0,
          render: () => React.createElement(
            "div",
            null,
            React.createElement(
              "article",
              null,
              React.createElement("div", null, state[1].get() ? React.createElement("strong", null, "Ready") : null),
              React.createElement("ul", null, ...items().map((item) => React.createElement("li", { key: item.id, "data-key": item.id }, item.label))),
            ),
          ),
          test: () => state[0].get(),
          truthy: outerBranch,
        }),
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0] },
      { kind: "block", id: 1, parent: 0, dependencies: [1] },
      { kind: "block", id: 2, parent: 0, dependencies: [2] },
    ],
  });
  const recursiveHostContainer = document.createElement("div");
  document.body.append(recursiveHostContainer);
  const recursiveHostRoot = createRoot(recursiveHostContainer);
  flushSync(() => recursiveHostRoot.render(React.createElement(RecursiveHostBlocks)));
  const initialRecursiveHostExecutions = recursiveHostExecutions;
  const initialRecursiveArticle = recursiveHostContainer.querySelector("article");
  const initialRecursiveRows = Object.fromEntries(
    [...recursiveHostContainer.querySelectorAll("[data-key]")].map((row) => [row.getAttribute("data-key"), row]),
  );
  recursiveHostContainer.querySelector("[data-recursive-update]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(recursiveHostContainer.querySelector("strong").textContent, "Ready");
  assert.deepEqual(
    [...recursiveHostContainer.querySelectorAll("[data-key]")].map((row) => row.getAttribute("data-key")),
    ["b", "a"],
  );
  assert.equal(recursiveHostContainer.querySelector("article"), initialRecursiveArticle);
  assert.equal(recursiveHostContainer.querySelector('[data-key="a"]'), initialRecursiveRows.a);
  assert.equal(recursiveHostContainer.querySelector('[data-key="b"]'), initialRecursiveRows.b);
  assert.equal(recursiveHostExecutions, initialRecursiveHostExecutions);
  flushSync(() => recursiveHostRoot.unmount());

  let mixedRangeExecutions = 0;
  const MixedRanges = createCompiledComponent({
    displayName: "CompatibilityMixedRanges",
    initialize: () => [{ title: "Header", accent: false, loading: false, error: false, items: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }] }],
    render(_props, state, blocks) {
      mixedRangeExecutions += 1;
      const model = () => state[0].get();
      const loadingBranch = {
        create: () => ({ kind: "element", tag: "p", attributes: [{ name: "data-loading", value: true }], styles: [], children: ["Loading"] }),
        bindings: [],
      };
      const errorBranch = {
        create: () => ({ kind: "element", tag: "strong", attributes: [{ name: "data-status", value: "error" }], styles: [], children: ["Error"] }),
        bindings: [],
      };
      const readyBranch = {
        create: () => ({ kind: "element", tag: "span", attributes: [{ name: "data-status", value: "ready" }], styles: [], children: ["Ready"] }),
        bindings: [],
      };
      const rowDescriptor = (item, index) => ({
        kind: "element",
        tag: "article",
        attributes: [{ name: "data-mixed-key", value: item.id }, { name: "data-index", value: index }],
        styles: [],
        children: [item.label],
      });
      const mixedBlock = () => ({
        kind: "mixed-ranges",
        id: 0,
        ranges: [
          { kind: "conditional", before: 1, test: () => model().loading, logical: true, truthy: loadingBranch },
          {
            kind: "keyed",
            before: 1,
            items: () => model().items,
            rowKey: (item) => item.id,
            create: rowDescriptor,
            bindings: [
              { kind: "attribute", path: [], name: "data-index", read: (_item, index) => index },
              { kind: "text", path: [], read: (item) => item.label },
            ],
          },
          { kind: "conditional", before: 0, test: () => model().error, truthy: errorBranch, falsy: readyBranch },
        ],
        trailing: 1,
        bindings: [
          { kind: "text", segment: 0, sibling: 0, path: [], read: () => model().title },
          { kind: "attribute", segment: 0, sibling: 0, path: [], name: "className", read: () => model().accent ? "accent" : "plain" },
          { kind: "text", segment: 1, sibling: 0, path: [], read: () => ["Rows ", model().items.length] },
          { kind: "attribute", segment: 1, sibling: 0, path: [], name: "data-count", read: () => model().items.length },
          { kind: "text", segment: 3, sibling: 0, path: [], read: () => model().error ? "Blocked" : "Ready" },
          { kind: "style", segment: 3, sibling: 0, path: [], name: "width", read: () => model().accent ? 24 : 12 },
        ],
      });
      const create = () => ({
        kind: "element",
        tag: "div",
        attributes: [{ name: "data-mixed-ranges", value: true }],
        styles: [],
        children: [
          { kind: "element", tag: "header", attributes: [{ name: "className", value: model().accent ? "accent" : "plain" }], styles: [], children: [model().title] },
          ...(model().loading ? [loadingBranch.create()] : []),
          { kind: "element", tag: "i", attributes: [{ name: "data-count", value: model().items.length }], styles: [], children: ["Rows ", model().items.length] },
          ...model().items.map(rowDescriptor),
          model().error ? errorBranch.create() : readyBranch.create(),
          { kind: "element", tag: "footer", attributes: [], styles: [{ name: "width", value: model().accent ? 24 : 12 }], children: [model().error ? "Blocked" : "Ready"] },
        ],
        block: mixedBlock(),
      });
      return React.createElement(
        "section",
        null,
        React.createElement("button", {
          "data-mixed-update": true,
          onClick: () => state[0].set((current) => ({
            title: "Updated header",
            accent: true,
            loading: true,
            error: true,
            items: [{ ...current.items[1], label: "Beta updated" }, current.items[0]],
          })),
        }, "Update mixed ranges"),
        React.createElement(blocks.MixedRanges, {
          id: 0,
          create,
          render: () => React.createElement(
            "div",
            { "data-mixed-ranges": true },
            React.createElement("header", { className: model().accent ? "accent" : "plain" }, model().title),
            model().loading ? React.createElement("p", { "data-loading": true }, "Loading") : null,
            React.createElement("i", { "data-count": model().items.length }, "Rows ", model().items.length),
            ...model().items.map((item, index) => React.createElement("article", { key: item.id, "data-mixed-key": item.id, "data-index": index }, item.label)),
            model().error
              ? React.createElement("strong", { "data-status": "error" }, "Error")
              : React.createElement("span", { "data-status": "ready" }, "Ready"),
            React.createElement("footer", { style: { width: model().accent ? 24 : 12 } }, model().error ? "Blocked" : "Ready"),
          ),
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const mixedRangeContainer = document.createElement("div");
  document.body.append(mixedRangeContainer);
  const mixedRangeRoot = createRoot(mixedRangeContainer);
  flushSync(() => mixedRangeRoot.render(React.createElement(MixedRanges)));
  const initialMixedRangeExecutions = mixedRangeExecutions;
  const originalMixedA = mixedRangeContainer.querySelector('[data-mixed-key="a"]');
  const originalMixedHeader = mixedRangeContainer.querySelector("header");
  mixedRangeContainer.querySelector("[data-mixed-update]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    [...mixedRangeContainer.querySelectorAll("[data-mixed-key]")].map((row) => row.getAttribute("data-mixed-key")),
    ["b", "a"],
  );
  assert.equal(mixedRangeContainer.querySelector('[data-mixed-key="a"]'), originalMixedA);
  assert.equal(mixedRangeContainer.querySelector("header"), originalMixedHeader);
  assert.equal(originalMixedHeader.textContent, "Updated header");
  assert.equal(originalMixedHeader.getAttribute("class"), "accent");
  assert.equal(mixedRangeContainer.querySelector("i").textContent, "Rows 2");
  assert.equal(mixedRangeContainer.querySelector("i").getAttribute("data-count"), "2");
  assert.equal(mixedRangeContainer.querySelector("footer").textContent, "Blocked");
  assert.equal(mixedRangeContainer.querySelector("footer").style.width, "24px");
  assert.equal(mixedRangeContainer.querySelector('[data-mixed-key="b"]').textContent, "Beta updated");
  assert.equal(mixedRangeContainer.querySelector("[data-loading]").textContent, "Loading");
  assert.equal(mixedRangeContainer.querySelector('[data-status="error"]').textContent, "Error");
  assert.equal(mixedRangeExecutions, initialMixedRangeExecutions);
  flushSync(() => mixedRangeRoot.unmount());

  let conditionalRangeExecutions = 0;
  const ConditionalRanges = createCompiledComponent({
    displayName: "CompatibilityConditionalRanges",
    initialize: () => [false, true, 0],
    render(_props, state, blocks) {
      conditionalRangeExecutions += 1;
      const branch = (tag, slot, label) => ({
        create: () => ({
          kind: "element",
          tag,
          attributes: [{ name: "data-slot", value: slot }],
          styles: [],
          children: [[label, " ", state[2].get()]],
        }),
        bindings: [
          { kind: "text", path: [], read: () => [label, " ", state[2].get()] },
        ],
      });
      return React.createElement(blocks.ConditionalRanges, {
        id: 0,
        ranges: [
          {
            before: 3,
            logical: true,
            test: () => state[0].get(),
            truthy: branch("p", "loading", "Loading"),
          },
          {
            before: 1,
            test: () => state[1].get(),
            truthy: branch("strong", "status", "Enabled"),
            falsy: branch("span", "status", "Disabled"),
          },
        ],
        trailing: 1,
        render: () =>
          React.createElement(
            "section",
            { "data-count": state[2].get(), "data-owner": "conditional-ranges" },
            React.createElement("header", { "data-static": "header" }, "Header"),
            React.createElement(
              "button",
              { "data-increment": true, onClick: () => state[2].set((value) => Number(value) + 1) },
              "Increment",
            ),
            React.createElement(
              "button",
              { "data-toggle-loading": true, onClick: () => state[0].set((value) => !value) },
              "Toggle loading",
            ),
            state[0].get()
              ? React.createElement("p", { "data-slot": "loading" }, "Loading ", state[2].get())
              : null,
            React.createElement("div", { "data-static": "divider" }, "Divider"),
            state[1].get()
              ? React.createElement("strong", { "data-slot": "status" }, "Enabled ", state[2].get())
              : React.createElement("span", { "data-slot": "status" }, "Disabled ", state[2].get()),
            React.createElement("footer", { "data-static": "footer", ref: blocks.target(0) }, "Count ", state[2].get()),
          ),
      });
    },
    bindings: [
      {
        kind: "attribute",
        path: [],
        dependencies: [2],
        name: "data-count",
        read: (_props, state) => state[2].get(),
      },
      {
        kind: "text",
        path: [5],
        target: 0,
        dependencies: [2],
        read: (_props, state) => ["Count ", state[2].get()],
      },
      { kind: "block", id: 0, dependencies: [0, 1, 2] },
    ],
  });
  const conditionalRangesContainer = document.createElement("div");
  document.body.append(conditionalRangesContainer);
  const conditionalRangesRoot = createRoot(conditionalRangesContainer);
  flushSync(() => conditionalRangesRoot.render(React.createElement(ConditionalRanges)));
  const conditionalRangesHost = conditionalRangesContainer.firstElementChild;
  const conditionalRangesHeader = conditionalRangesContainer.querySelector("[data-static='header']");
  const conditionalRangesStatus = conditionalRangesContainer.querySelector("[data-slot='status']");
  const initialConditionalRangeExecutions = conditionalRangeExecutions;
  conditionalRangesContainer.querySelector("[data-increment]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(conditionalRangesContainer.firstElementChild, conditionalRangesHost);
  assert.equal(conditionalRangesContainer.firstElementChild.dataset.count, "1");
  assert.equal(conditionalRangesContainer.querySelector("[data-static='header']"), conditionalRangesHeader);
  assert.equal(conditionalRangesContainer.querySelector("[data-slot='status']"), conditionalRangesStatus);
  assert.equal(conditionalRangesStatus.textContent, "Enabled 1");
  assert.equal(conditionalRangesContainer.querySelector("[data-static='footer']").textContent, "Count 1");
  conditionalRangesContainer.querySelector("[data-toggle-loading]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(conditionalRangesContainer.querySelector("[data-slot='loading']").textContent, "Loading 1");
  assert.equal(conditionalRangesContainer.firstElementChild, conditionalRangesHost);
  assert.equal(conditionalRangeExecutions, initialConditionalRangeExecutions);
  flushSync(() => conditionalRangesRoot.unmount());

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
          collectionDependency: 0,
          dependencies: [0],
          structureDependencies: [0],
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

  let keyedHostRowExecutions = 0;
  const KeyedHostRows = createCompiledComponent({
    displayName: "CompatibilityKeyedHostRows",
    initialize: () => [[
      { id: "a", label: "Alpha", done: false, detail: false },
      { id: "b", label: "Beta", done: true, detail: true },
      { id: "c", label: "Gamma", done: false, detail: true },
    ]],
    render(_props, state, blocks) {
      keyedHostRowExecutions += 1;
      const items = () => state[0].get();
      const descriptor = (item, index) => {
        const detailBranch = {
          create: () => ({ kind: "element", tag: "small", attributes: [], styles: [], children: [item.label, " detail"] }),
          bindings: [{ kind: "text", path: [], read: () => [item.label, " detail"] }],
        };
        const doneBranch = {
          create: () => ({
            kind: "element",
            tag: "article",
            attributes: [],
            styles: [],
            children: [
              { kind: "element", tag: "strong", attributes: [], styles: [], children: [item.label, " done"] },
              {
                kind: "element",
                tag: "div",
                attributes: [],
                styles: [],
                children: [item.detail ? detailBranch.create() : null],
                block: {
                  kind: "conditional-ranges",
                  id: 2,
                  ranges: [{ before: 0, test: () => item.detail, logical: true, truthy: detailBranch }],
                  trailing: 0,
                },
              },
            ],
          }),
          bindings: [{ kind: "text", path: [0], read: () => [item.label, " done"] }],
        };
        const openBranch = {
          create: () => ({ kind: "element", tag: "aside", attributes: [], styles: [], children: [item.label, " open"] }),
          bindings: [{ kind: "text", path: [], read: () => [item.label, " open"] }],
        };
        return {
          kind: "element",
          tag: "li",
          attributes: [{ name: "data-key", value: item.id }, { name: "data-index", value: index }],
          styles: [],
          children: [
            { kind: "element", tag: "span", attributes: [], styles: [], children: [item.label] },
            {
              kind: "element",
              tag: "div",
              attributes: [{ name: "data-status", value: "" }],
              styles: [],
              children: [
                { kind: "element", tag: "i", attributes: [], styles: [], children: ["State"] },
                item.done ? doneBranch.create() : openBranch.create(),
                { kind: "element", tag: "b", attributes: [], styles: [], children: ["Prepared"] },
              ],
              block: {
                kind: "conditional-ranges",
                id: 1,
                ranges: [{ before: 1, test: () => item.done, truthy: doneBranch, falsy: openBranch }],
                trailing: 1,
              },
            },
          ],
        };
      };
      const row = (item, index) => React.createElement(
        "li",
        { key: item.id, "data-key": item.id, "data-index": index },
        React.createElement("span", null, item.label),
        React.createElement(
          "div",
          { "data-status": true },
          React.createElement("i", null, "State"),
          item.done
            ? React.createElement(
                "article",
                null,
                React.createElement("strong", null, item.label, " done"),
                React.createElement("div", null, item.detail ? React.createElement("small", null, item.label, " detail") : null),
              )
            : React.createElement("aside", null, item.label, " open"),
          React.createElement("b", null, "Prepared"),
        ),
      );
      return React.createElement(
        "section",
        null,
        React.createElement("button", {
          "data-keyed-host-update": true,
          onClick: () => state[0].set((current) => {
            const [a, b, c] = current;
            return [{ ...c, done: true }, a, { ...b, label: "Beta newest", detail: false }];
          }),
        }, "Update keyed host rows"),
        React.createElement(blocks.KeyedRows, {
          id: 0,
          hostBlocks: true,
          items,
          rowKey: (item) => item.id,
          create: descriptor,
          bindings: [
            { kind: "attribute", path: [], name: "data-index", read: (_item, index) => index },
            { kind: "text", path: [0], read: (item) => [item.label] },
          ],
          render: () => React.createElement("ul", null, ...items().map(row)),
        }),
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0] },
      { kind: "block", id: 1, parent: 0, dependencies: [] },
      { kind: "block", id: 2, parent: 1, dependencies: [] },
    ],
  });
  const keyedHostContainer = document.createElement("div");
  document.body.append(keyedHostContainer);
  const keyedHostRoot = createRoot(keyedHostContainer);
  flushSync(() => keyedHostRoot.render(React.createElement(KeyedHostRows)));
  const initialKeyedHostExecutions = keyedHostRowExecutions;
  const originalKeyedHostB = keyedHostContainer.querySelector('[data-key="b"]');
  const originalKeyedHostBArticle = originalKeyedHostB.querySelector("article");
  const originalKeyedHostBStatic = originalKeyedHostB.querySelector("i");
  keyedHostContainer.querySelector("[data-keyed-host-update]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    [...keyedHostContainer.querySelectorAll("li")].map((row) => row.getAttribute("data-key")),
    ["c", "a", "b"],
  );
  assert.equal(keyedHostContainer.querySelector('[data-key="b"]'), originalKeyedHostB);
  assert.equal(keyedHostContainer.querySelector('[data-key="b"] article'), originalKeyedHostBArticle);
  assert.equal(keyedHostContainer.querySelector('[data-key="b"] i'), originalKeyedHostBStatic);
  assert.equal(keyedHostContainer.querySelector('[data-key="b"] strong').textContent, "Beta newest done");
  assert.equal(keyedHostContainer.querySelector('[data-key="b"] small'), null);
  assert.equal(keyedHostContainer.querySelector('[data-key="c"] article').textContent, "Gamma doneGamma detail");
  assert.equal(keyedHostRowExecutions, initialKeyedHostExecutions);
  flushSync(() => keyedHostRoot.unmount());

  let nestedKeyedExecutions = 0;
  const NestedKeyedRows = createCompiledComponent({
    displayName: "CompatibilityNestedKeyedRows",
    initialize: () => [[
      { id: "a", name: "Alpha", tasks: [{ id: "a1", title: "Design", tags: [{ id: "a1x", label: "Idea" }] }, { id: "a2", title: "Build", tags: [{ id: "a2x", label: "Ready" }] }] },
      { id: "b", name: "Beta", tasks: [{ id: "b1", title: "Test", tags: [{ id: "b1x", label: "Check" }] }, { id: "b2", title: "Ship", tags: [{ id: "b2x", label: "Next" }, { id: "b2y", label: "Now" }] }] },
    ]],
    render(_props, state, blocks) {
      nestedKeyedExecutions += 1;
      const projects = () => state[0].get();
      const tagDescriptor = (tag, index) => ({
        kind: "element",
        tag: "li",
        attributes: [{ name: "data-tag", value: tag.id }, { name: "data-index", value: index }],
        styles: [],
        children: [tag.label],
      });
      const taskDescriptor = (task, index) => ({
        kind: "element",
        tag: "li",
        attributes: [{ name: "data-task", value: task.id }, { name: "data-index", value: index }],
        styles: [],
        children: [
          { kind: "element", tag: "span", attributes: [], styles: [], children: [task.title] },
          {
            kind: "element",
            tag: "ul",
            attributes: [],
            styles: [],
            children: [
              { kind: "element", tag: "i", attributes: [], styles: [], children: ["Tags"] },
              ...task.tags.map(tagDescriptor),
              { kind: "element", tag: "b", attributes: [], styles: [], children: ["End tags"] },
            ],
            block: {
              kind: "keyed-ranges",
              id: 2,
              ranges: [{
                before: 1,
                items: () => task.tags,
                rowKey: (tag) => tag.id,
                create: tagDescriptor,
                bindings: [
                  { kind: "attribute", path: [], name: "data-index", read: (_tag, tagIndex) => tagIndex },
                  { kind: "text", path: [], read: (tag) => [tag.label] },
                ],
              }],
              trailing: 1,
            },
          },
        ],
      });
      const projectDescriptor = (project, index) => ({
        kind: "element",
        tag: "section",
        attributes: [{ name: "data-project", value: project.id }, { name: "data-index", value: index }],
        styles: [],
        children: [
          { kind: "element", tag: "h3", attributes: [], styles: [], children: [project.name] },
          {
            kind: "element",
            tag: "ul",
            attributes: [],
            styles: [],
            children: [
              { kind: "element", tag: "i", attributes: [], styles: [], children: ["Tasks"] },
              ...project.tasks.map(taskDescriptor),
              { kind: "element", tag: "b", attributes: [], styles: [], children: ["End"] },
            ],
            block: {
              kind: "keyed-ranges",
              id: 1,
              ranges: [{
                before: 1,
                items: () => project.tasks,
                rowKey: (task) => task.id,
                create: taskDescriptor,
                bindings: [
                  { kind: "attribute", path: [], name: "data-index", read: (_task, taskIndex) => taskIndex },
                  { kind: "text", path: [0], read: (task) => [task.title] },
                ],
              }],
              trailing: 1,
            },
          },
        ],
      });
      const projectMarkup = (project, index) => React.createElement(
        "section",
        { key: project.id, "data-project": project.id, "data-index": index },
        React.createElement("h3", null, project.name),
        React.createElement(
          "ul",
          null,
          React.createElement("i", null, "Tasks"),
          ...project.tasks.map((task, taskIndex) =>
            React.createElement(
              "li",
              { key: task.id, "data-task": task.id, "data-index": taskIndex },
              React.createElement("span", null, task.title),
              React.createElement(
                "ul",
                null,
                React.createElement("i", null, "Tags"),
                ...task.tags.map((tag, tagIndex) =>
                  React.createElement("li", { key: tag.id, "data-tag": tag.id, "data-index": tagIndex }, tag.label),
                ),
                React.createElement("b", null, "End tags"),
              ),
            ),
          ),
          React.createElement("b", null, "End"),
        ),
      );
      return React.createElement(
        "main",
        null,
        React.createElement("button", {
          "data-nested-keyed-update": true,
          onClick: () => state[0].set((current) => {
            const [a, b] = current;
            return [
              { ...b, name: "Beta newest", tasks: [{ ...b.tasks[1], title: "Ship now", tags: [{ ...b.tasks[1].tags[1], label: "Now updated" }, b.tasks[1].tags[0]] }, b.tasks[0]] },
              a,
            ];
          }),
        }, "Update nested keyed rows"),
        React.createElement(blocks.KeyedRows, {
          id: 0,
          hostBlocks: true,
          items: projects,
          rowKey: (project) => project.id,
          create: projectDescriptor,
          bindings: [
            { kind: "attribute", path: [], name: "data-index", read: (_project, index) => index },
            { kind: "text", path: [0], read: (project) => [project.name] },
          ],
          render: () => React.createElement("div", null, ...projects().map(projectMarkup)),
        }),
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0] },
      { kind: "block", id: 1, parent: 0, dependencies: [] },
      { kind: "block", id: 2, parent: 1, dependencies: [] },
    ],
  });
  const nestedKeyedContainer = document.createElement("div");
  document.body.append(nestedKeyedContainer);
  const nestedKeyedRoot = createRoot(nestedKeyedContainer);
  flushSync(() => nestedKeyedRoot.render(React.createElement(NestedKeyedRows)));
  const initialNestedKeyedExecutions = nestedKeyedExecutions;
  const originalProjectB = nestedKeyedContainer.querySelector('[data-project="b"]');
  const originalTaskB1 = nestedKeyedContainer.querySelector('[data-task="b1"]');
  const originalTaskB2 = nestedKeyedContainer.querySelector('[data-task="b2"]');
  const originalTagB2X = nestedKeyedContainer.querySelector('[data-tag="b2x"]');
  const originalTagB2Y = nestedKeyedContainer.querySelector('[data-tag="b2y"]');
  const originalNestedStatic = originalProjectB.querySelector("ul > i");
  nestedKeyedContainer.querySelector("[data-nested-keyed-update]").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    [...nestedKeyedContainer.querySelectorAll("[data-project]")].map((row) => row.dataset.project),
    ["b", "a"],
  );
  assert.deepEqual(
    [...originalProjectB.querySelectorAll("[data-task]")].map((row) => row.dataset.task),
    ["b2", "b1"],
  );
  assert.equal(nestedKeyedContainer.querySelector('[data-project="b"]'), originalProjectB);
  assert.equal(nestedKeyedContainer.querySelector('[data-task="b1"]'), originalTaskB1);
  assert.equal(nestedKeyedContainer.querySelector('[data-task="b2"]'), originalTaskB2);
  assert.equal(nestedKeyedContainer.querySelector('[data-tag="b2x"]'), originalTagB2X);
  assert.equal(nestedKeyedContainer.querySelector('[data-tag="b2y"]'), originalTagB2Y);
  assert.deepEqual(
    [...originalTaskB2.querySelectorAll("[data-tag]")].map((row) => row.dataset.tag),
    ["b2y", "b2x"],
  );
  assert.equal(originalProjectB.querySelector("ul > i"), originalNestedStatic);
  assert.equal(originalTaskB2.querySelector(":scope > span").textContent, "Ship now");
  assert.equal(originalTagB2Y.textContent, "Now updated");
  assert.equal(nestedKeyedExecutions, initialNestedKeyedExecutions);
  flushSync(() => nestedKeyedRoot.unmount());

  let keyedRangeExecutions = 0;
  const KeyedRanges = createCompiledComponent({
    displayName: "CompatibilityKeyedRanges",
    initialize: () => [{ primary: ["a", "b", "c"], secondary: ["x", "y"] }],
    render(_props, state, blocks) {
      keyedRangeExecutions += 1;
      const model = () => state[0].get();
      const descriptor = (before, items) => ({
        before,
        items,
        rowKey: (item) => item,
        create: (item, index) => ({
          kind: "element",
          tag: "li",
          attributes: [
            { name: "data-key", value: item },
            { name: "data-index", value: index },
          ],
          styles: [],
          children: [index + ":" + item.toUpperCase()],
        }),
        bindings: [
          { kind: "attribute", path: [], name: "data-index", read: (_item, index) => index },
          { kind: "text", path: [], read: (item, index) => [index, ":", item.toUpperCase()] },
        ],
      });
      return React.createElement(blocks.KeyedRanges, {
        id: 0,
        render: () =>
          React.createElement(
            "ul",
            { "data-count": model().primary.length + model().secondary.length },
            React.createElement(
              "li",
              { "data-static": "header" },
              "Primary ",
              React.createElement(
                "button",
                {
                  onClick: () =>
                    state[0].set((current) => ({
                      primary: [...current.primary].reverse(),
                      secondary: [current.secondary[1], "z", current.secondary[0]],
                    })),
                },
                "Update ranges",
              ),
            ),
              model().primary.map((item, index) =>
                React.createElement(
                  "li",
                  { key: item, "data-key": item, "data-index": index },
                  index + ":" + item.toUpperCase(),
                ),
              ),
              React.createElement("li", { "data-static": "divider" }, "Secondary"),
              model().secondary.map((item, index) =>
                React.createElement(
                  "li",
                  { key: item, "data-key": item, "data-index": index },
                  index + ":" + item.toUpperCase(),
                ),
              ),
              React.createElement("li", { "data-static": "footer" }, "End"),
          ),
        ranges: [
          descriptor(1, () => model().primary),
          descriptor(1, () => model().secondary),
        ],
        trailing: 1,
      });
    },
    bindings: [
      {
        kind: "attribute",
        path: [],
        target: 0,
        dependencies: [0],
        name: "data-count",
        read: (_props, state) => {
          const model = state[0].get();
          return model.primary.length + model.secondary.length;
        },
      },
      { kind: "block", id: 0, dependencies: [0] },
    ],
  });
  const keyedRangesContainer = document.createElement("div");
  document.body.append(keyedRangesContainer);
  const keyedRangesRoot = createRoot(keyedRangesContainer);
  flushSync(() => keyedRangesRoot.render(React.createElement(KeyedRanges)));
  const initialKeyedRangeExecutions = keyedRangeExecutions;
  const rangeHeader = keyedRangesContainer.querySelector("[data-static='header']");
  const rangeDivider = keyedRangesContainer.querySelector("[data-static='divider']");
  const rangeFooter = keyedRangesContainer.querySelector("[data-static='footer']");
  const rangeA = keyedRangesContainer.querySelector("[data-key='a']");
  keyedRangesContainer.querySelector("button").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    [...keyedRangesContainer.querySelectorAll("[data-key]")].map((row) => row.dataset.key),
    ["c", "b", "a", "y", "z", "x"],
  );
  assert.equal(keyedRangesContainer.querySelector("[data-static='header']"), rangeHeader);
  assert.equal(keyedRangesContainer.querySelector("[data-static='divider']"), rangeDivider);
  assert.equal(keyedRangesContainer.querySelector("[data-static='footer']"), rangeFooter);
  assert.equal(keyedRangesContainer.querySelector("[data-key='a']"), rangeA);
  assert.equal(keyedRangesContainer.firstElementChild.tagName, "UL");
  assert.equal(keyedRangesContainer.firstElementChild.dataset.count, "6");
  assert.equal(keyedRangeExecutions, initialKeyedRangeExecutions);
  flushSync(() => keyedRangesRoot.unmount());

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
          collectionDependency: 0,
          dependencies: [0],
          structureDependencies: [0],
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
                state[0].set((current) => {
                  const changedIndices = [];
                  const next = current.map((row, rowIndex) => {
                    const mapped = row.id === item.id
                      ? { ...row, label: item.label + "!", done: !item.done }
                      : row;
                    if (mapped !== row) changedIndices.push(rowIndex);
                    return mapped;
                  });
                  return createCompilerKeyedMapUpdate(current, next, changedIndices);
                });
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

  let appendRows = () => undefined;
  let appendKeyReads = 0;
  const AppendRows = createCompiledComponent({
    displayName: "CompatibilityAppendRows",
    initialize: () => [[{ id: "a", label: "Alpha" }]],
    render(_props, state, blocks) {
      const items = () => state[0].get();
      appendRows = (addition) =>
        state[0].set((previous) =>
          createCompilerKeyedArrayAppend(
            previous,
            [...previous, addition],
          ),
        );
      return React.createElement(
        "section",
        null,
        React.createElement(blocks.KeyedRows, {
          collectionDependency: 0,
          dependencies: [0],
          id: 0,
          items,
          structureDependencies: [0],
          render: () =>
            React.createElement(
              "ul",
              null,
              items().map((item) =>
                React.createElement("li", { "data-key": item.id, key: item.id }, item.label),
              ),
            ),
          rowKey: (item) => {
            appendKeyReads += 1;
            return item.id;
          },
          create: (item) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item.id }],
            styles: [],
            children: [item.label],
          }),
          bindings: [{ kind: "text", path: [], dependencies: [], read: (item) => [item.label] }],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const appendContainer = document.createElement("div");
  document.body.append(appendContainer);
  const appendRoot = createRoot(appendContainer);
  flushSync(() => appendRoot.render(React.createElement(AppendRows)));
  const appendAlpha = appendContainer.querySelector("[data-key='a']");
  appendKeyReads = 0;
  appendRows({ id: "b", label: "Beta" });
  appendRows({ id: "c", label: "Gamma" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(appendContainer.textContent, "AlphaBetaGamma");
  assert.equal(appendContainer.querySelector("[data-key='a']"), appendAlpha);
  assert.equal(appendKeyReads, 2);
  flushSync(() => appendRoot.unmount());

  let filterRows = () => undefined;
  let filterKeyReads = 0;
  let filterBindingReads = 0;
  const FilterRows = createCompiledComponent({
    displayName: "CompatibilityFilterRows",
    initialize: () => [[
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ]],
    render(_props, state, blocks) {
      const items = () => state[0].get();
      filterRows = (removedId) =>
        state[0].set((previous) =>
          createCompilerKeyedArrayFilter(
            previous,
            previous.filter,
            (item) => item.id !== removedId,
          ),
        );
      return React.createElement(
        "section",
        null,
        React.createElement(blocks.KeyedRows, {
          collectionDependency: 0,
          dependencies: [0],
          filterIndexIndependent: true,
          id: 0,
          items,
          structureDependencies: [0],
          render: () =>
            React.createElement(
              "ul",
              null,
              items().map((item) =>
                React.createElement("li", { "data-key": item.id, key: item.id }, item.label),
              ),
            ),
          rowKey: (item) => {
            filterKeyReads += 1;
            return item.id;
          },
          create: (item) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item.id }],
            styles: [],
            children: [item.label],
          }),
          bindings: [{
            kind: "text",
            path: [],
            dependencies: [],
            read: (item) => {
              filterBindingReads += 1;
              return [item.label];
            },
          }],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const filterContainer = document.createElement("div");
  document.body.append(filterContainer);
  const filterRoot = createRoot(filterContainer);
  flushSync(() => filterRoot.render(React.createElement(FilterRows)));
  const filterAlpha = filterContainer.querySelector("[data-key='a']");
  const filterGamma = filterContainer.querySelector("[data-key='c']");
  filterKeyReads = 0;
  filterBindingReads = 0;
  filterRows("b");
  filterRows("d");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(filterContainer.textContent, "AlphaGamma");
  assert.equal(filterContainer.querySelector("[data-key='a']"), filterAlpha);
  assert.equal(filterContainer.querySelector("[data-key='c']"), filterGamma);
  assert.equal(filterKeyReads, 2);
  assert.equal(filterBindingReads, 0);
  flushSync(() => filterRoot.unmount());

  let sliceRows = () => undefined;
  let sliceKeyReads = 0;
  let sliceBindingReads = 0;
  const SliceRows = createCompiledComponent({
    displayName: "CompatibilitySliceRows",
    initialize: () => [[
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ]],
    render(_props, state, blocks) {
      const items = () => state[0].get();
      sliceRows = (start, end) =>
        state[0].set((previous) =>
          end === undefined
            ? createCompilerKeyedArraySlice(previous, previous.slice, start)
            : createCompilerKeyedArraySlice(previous, previous.slice, start, end),
        );
      return React.createElement(
        "section",
        null,
        React.createElement(blocks.KeyedRows, {
          collectionDependency: 0,
          dependencies: [0],
          filterIndexIndependent: true,
          id: 0,
          items,
          structureDependencies: [0],
          render: () =>
            React.createElement(
              "ul",
              null,
              items().map((item) =>
                React.createElement("li", { "data-key": item.id, key: item.id }, item.label),
              ),
            ),
          rowKey: (item) => {
            sliceKeyReads += 1;
            return item.id;
          },
          create: (item) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item.id }],
            styles: [],
            children: [item.label],
          }),
          bindings: [{
            kind: "text",
            path: [],
            dependencies: [],
            read: (item) => {
              sliceBindingReads += 1;
              return [item.label];
            },
          }],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const sliceContainer = document.createElement("div");
  document.body.append(sliceContainer);
  const sliceRoot = createRoot(sliceContainer);
  flushSync(() => sliceRoot.render(React.createElement(SliceRows)));
  const sliceGamma = sliceContainer.querySelector("[data-key='c']");
  sliceKeyReads = 0;
  sliceBindingReads = 0;
  sliceRows(1);
  sliceRows(1, -1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sliceContainer.textContent, "Gamma");
  assert.equal(sliceContainer.querySelector("[data-key='c']"), sliceGamma);
  assert.equal(sliceKeyReads, 0);
  assert.equal(sliceBindingReads, 0);
  flushSync(() => sliceRoot.unmount());

  let prependRows = () => undefined;
  let prependKeyReads = 0;
  let prependBindingReads = 0;
  const PrependRows = createCompiledComponent({
    displayName: "CompatibilityPrependRows",
    initialize: () => [[
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]],
    render(_props, state, blocks) {
      const items = () => state[0].get();
      prependRows = (addition) =>
        state[0].set((previous) =>
          createCompilerKeyedArrayPrepend(previous, [addition, ...previous]),
        );
      return React.createElement(
        "section",
        null,
        React.createElement(blocks.KeyedRows, {
          collectionDependency: 0,
          dependencies: [0],
          prependIndexIndependent: true,
          id: 0,
          items,
          structureDependencies: [0],
          render: () =>
            React.createElement(
              "ul",
              null,
              items().map((item) =>
                React.createElement("li", { "data-key": item.id, key: item.id }, item.label),
              ),
            ),
          rowKey: (item) => {
            prependKeyReads += 1;
            return item.id;
          },
          create: (item) => ({
            kind: "element",
            tag: "li",
            attributes: [{ name: "data-key", value: item.id }],
            styles: [],
            children: [item.label],
          }),
          bindings: [{
            kind: "text",
            path: [],
            dependencies: [],
            read: (item) => {
              prependBindingReads += 1;
              return [item.label];
            },
          }],
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const prependContainer = document.createElement("div");
  document.body.append(prependContainer);
  const prependRoot = createRoot(prependContainer);
  flushSync(() => prependRoot.render(React.createElement(PrependRows)));
  const prependAlpha = prependContainer.querySelector("[data-key='a']");
  const prependBeta = prependContainer.querySelector("[data-key='b']");
  prependKeyReads = 0;
  prependBindingReads = 0;
  prependRows({ id: "c", label: "Gamma" });
  prependRows({ id: "d", label: "Delta" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(prependContainer.textContent, "DeltaGammaAlphaBeta");
  assert.equal(prependContainer.querySelector("[data-key='a']"), prependAlpha);
  assert.equal(prependContainer.querySelector("[data-key='b']"), prependBeta);
  assert.equal(prependKeyReads, 2);
  assert.equal(prependBindingReads, 2);
  flushSync(() => prependRoot.unmount());

  let editableRowExecutions = 0;
  let editableListRenders = 0;
  let setEditableItems = () => undefined;
  const EditableKeyedRows = createCompiledComponent({
    displayName: "CompatibilityEditableKeyedRows",
    initialize: () => [[
      { id: "a", label: "Alpha", done: false },
      { id: "b", label: "Beta", done: true },
    ]],
    render(_props, state, blocks) {
      editableRowExecutions += 1;
      setEditableItems = (next) => state[0].set(next);
      const items = () => state[0].get();
      const update = (id, patch) =>
        state[0].set((current) =>
          current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        );
      return React.createElement(
        "section",
        null,
        React.createElement(blocks.KeyedRows, {
          id: 0,
          render: (rowEvent) => {
            editableListRenders += 1;
            return React.createElement(
              "ul",
              null,
              items().map((item, index) =>
                React.createElement(
                  "li",
                  { key: item.id, "data-key": item.id },
                  React.createElement("input", {
                    "aria-label": "Label " + item.id,
                    onInput: rowEvent(item, index, 0),
                    value: item.label,
                  }),
                  React.createElement("input", {
                    "aria-label": "Done " + item.id,
                    checked: item.done,
                    onChange: rowEvent(item, index, 1),
                    type: "checkbox",
                  }),
                  React.createElement(
                    "output",
                    null,
                    index + ":" + item.label + ":" + (item.done ? "done" : "open"),
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
                tag: "input",
                attributes: [
                  { name: "aria-label", value: "Label " + item.id },
                  { name: "value", value: item.label },
                ],
                styles: [],
                children: [],
              },
              {
                kind: "element",
                tag: "input",
                attributes: [
                  { name: "aria-label", value: "Done " + item.id },
                  { name: "checked", value: item.done },
                  { name: "type", value: "checkbox" },
                ],
                styles: [],
                children: [],
              },
              {
                kind: "element",
                tag: "output",
                attributes: [],
                styles: [],
                children: [index + ":" + item.label + ":" + (item.done ? "done" : "open")],
              },
            ],
          }),
          bindings: [
            { kind: "attribute", path: [0], name: "value", read: (item) => item.label },
            { kind: "attribute", path: [1], name: "checked", read: (item) => item.done },
            {
              kind: "text",
              path: [2],
              read: (item, index) => [index, ":", item.label, ":", item.done ? "done" : "open"],
            },
          ],
          events: [
            {
              name: "onInput",
              path: [0],
              invoke: (item, _index, event) => update(item.id, { label: event.currentTarget.value }),
            },
            {
              name: "onChange",
              path: [1],
              invoke: (item, _index, event) => update(item.id, { done: event.currentTarget.checked }),
            },
          ],
          delegateEvents: true,
        }),
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });

  const editableContainer = document.createElement("div");
  document.body.append(editableContainer);
  const editableRoot = createRoot(editableContainer);
  flushSync(() => editableRoot.render(React.createElement(EditableKeyedRows)));
  const initialEditableExecutions = editableRowExecutions;
  const initialEditableRenders = editableListRenders;
  const editableAlpha = editableContainer.querySelector("[data-key='a']");
  const editableInput = editableAlpha.querySelector("[aria-label='Label a']");
  editableInput.focus();
  editableInput.value = "AlXpha";
  editableInput.setSelectionRange(3, 3);
  editableInput.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: "X" }));
  editableInput.value = "Alpha";
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(editableInput.value, "AlXpha");
  assert.equal(editableInput.selectionStart, 3);
  assert.equal(editableInput.selectionEnd, 3);
  editableAlpha.querySelector("[aria-label='Done a']").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(editableAlpha.querySelector("[aria-label='Done a']").checked, true);
  assert.equal(editableAlpha.querySelector("output").textContent, "0:AlXpha:done");
  assert.equal(editableRowExecutions, initialEditableExecutions);
  assert.equal(editableListRenders, initialEditableRenders);
  setEditableItems((current) => [...current].reverse());
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  assert.equal(editableContainer.querySelector("[data-key='a']"), editableAlpha);
  assert.equal(editableContainer.querySelector("[aria-label='Label a']"), editableInput);
  assert.equal(editableAlpha.querySelector("output").textContent, "1:AlXpha:done");
  assert.equal(editableListRenders, initialEditableRenders);
  flushSync(() => editableRoot.unmount());

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
