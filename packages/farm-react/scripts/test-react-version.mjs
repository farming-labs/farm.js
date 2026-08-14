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
  globalThis.HTMLOptionElement = dom.window.HTMLOptionElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
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
