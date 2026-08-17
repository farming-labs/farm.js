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
