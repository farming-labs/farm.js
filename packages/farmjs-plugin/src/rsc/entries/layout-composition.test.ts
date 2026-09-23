import React from "react";
import { expect, it } from "vitest";
import { generateRscEntry } from "./rsc.js";

const entry = generateRscEntry({
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "layouts",
  debug: false,
});
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

it("retains a layout module reused at more than one ancestor", () => {
  const start = entry.indexOf("function getRouteModules(");
  const end = entry.indexOf("\n}\n\n/**\n * Main request handler", start) + 2;
  const shared = { default: () => null };
  const getLayouts = new Function(
    "layouts",
    `${entry.slice(start, end)}; return getLayoutModules;`,
  )({ "/layout.tsx": shared, "/team/layout.tsx": shared });
  expect(getLayouts("/team/page.tsx")).toEqual([shared, shared]);
});

function compose(
  modules: unknown[],
  page: unknown,
  props = {
    params: { id: "1" },
    searchParams: { tag: ["a", "b"] },
    middlewareData: { role: "reader" },
  },
) {
  const start = entry.indexOf("const LayoutModules = getLayoutModules(pattern);");
  const end = entry.indexOf("const metadata =", start);
  const renderStart = entry.indexOf("// Render layout");
  const renderEnd = entry.indexOf("// Single wrapper", renderStart);
  return new AsyncFunction(
    "pattern",
    "getLayoutModules",
    "h",
    "pageContent",
    "pageProps",
    `${entry.slice(start, end)}\n${entry.slice(renderStart, renderEnd)}; return layoutContent;`,
  )("/team/page.tsx", () => modules, React.createElement, page, props);
}

it("wraps the page with every root-to-leaf layout and passes only the layout props contract", async () => {
  const Root = () => null;
  const Nested = () => null;
  const page = React.createElement("main", null, "page");
  const result = await compose([{ default: Root }, { default: Nested }], page);
  expect(result.type).toBe(Root);
  expect(result.props.children.type).toBe(Nested);
  expect(result.props.children.props.children).toBe(page);
  expect(result.props.params).toEqual({ id: "1" });
  expect(result.props.children.props.params).toEqual({ id: "1" });
  expect(result.props).not.toHaveProperty("searchParams");
  expect(result.props).not.toHaveProperty("middlewareData");
});

it("preserves the page without introducing a layout when no layout exists", async () => {
  const page = React.createElement("main");
  expect(await compose([], page)).toBe(page);
});

it("composes native async parent layouts around synchronous children", async () => {
  const Nested = () => null;
  async function Root({ children, params }: any) {
    return React.createElement("section", { "data-id": params.id }, children);
  }
  const result = await compose([{ default: Root }, { default: Nested }], "page");
  expect(result.type).toBe("section");
  expect(result.props["data-id"]).toBe("1");
  expect(result.props.children.type).toBe(Nested);
});
