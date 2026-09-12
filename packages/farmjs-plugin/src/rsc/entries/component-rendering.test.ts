import React from "react";
import { expect, it } from "vitest";
import { generateRscEntry } from "./rsc.js";

const entry = generateRscEntry({
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "components",
  debug: false,
});
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function render(kind: "Page" | "Layout", Component: unknown) {
  const isPage = kind === "Page";
  const start = entry.indexOf(isPage ? "// Render page content" : "// Render layout");
  const end = entry.indexOf(
    isPage ? "// Route-level loading boundary" : "// Single wrapper",
    start,
  );
  return new AsyncFunction(
    kind,
    "h",
    "pageProps",
    "initialPageContent",
    `${isPage ? "" : "const pageContent = initialPageContent;"}${entry.slice(start, end)}; return ${isPage ? "pageContent" : "layoutContent"};`,
  )(Component, React.createElement, { params: { id: "1" } }, "child");
}

it.each(["Page", "Layout"] as const)(
  "leaves synchronous %s functions containing async text to React",
  async (kind) => {
    function Component() {
      throw new Error("async is just text, not a reason to call me directly");
    }
    const element = await render(kind, Component);
    expect(React.isValidElement(element)).toBe(true);
    expect(element.type).toBe(Component);
  },
);

it.each(["Page", "Layout"] as const)("does not inspect %s source text", async (kind) => {
  function Component() {
    return null;
  }
  Component.toString = () => {
    throw new Error("source inspection is not rendering");
  };
  expect((await render(kind, Component)).type).toBe(Component);
});

it.each(["Page", "Layout"] as const)("preserves native async %s execution", async (kind) => {
  async function Component(props: { children?: unknown; params?: { id: string } }) {
    return kind === "Page" ? props.params!.id : props.children;
  }
  expect(await render(kind, Component)).toBe(kind === "Page" ? "1" : "child");
});
