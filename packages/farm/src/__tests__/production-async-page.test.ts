import fs from "fs";
import path from "path";
import React from "react";
import { describe, expect, it } from "vitest";

// The production renderer is emitted as a template literal, so extract the
// generated renderPageElement block and execute it against stub components to
// verify how the shipped handler treats sync vs async pages.

const universalBuildPath = path.join(process.cwd(), "src", "nitro", "universal-build.ts");
const nitroIndexPath = path.join(process.cwd(), "src", "nitro", "index.ts");

function extractRenderPageElement(source: string): string {
  const start = source.indexOf("const renderPageElement = async () => {");
  const endMarker = "return renderFarmElement(ReactDOMServer, wrappedElement);";
  const endIndex = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("};", endIndex) + 2);
}

async function runRenderPageElement(
  PageComponent: unknown,
  options: { isRedirect?: (error: unknown) => boolean } = {},
): Promise<{ pageTree: any }> {
  const source = fs.readFileSync(universalBuildPath, "utf-8");
  let pageTree: any;
  const run = new Function(
    "PageComponent",
    "pageProps",
    "React",
    "isFarmRedirectError",
    "isFarmNotFoundError",
    "route",
    "shouldHydrateLayout",
    "hydrationIslandStrategy",
    "applicableLayouts",
    "renderedRouteSlots",
    "params",
    "renderFarmElement",
    "ReactDOMServer",
    "wrapWithFarmIntegrationProviders",
    `${extractRenderPageElement(source)}\nreturn renderPageElement();`,
  );
  await run(
    PageComponent,
    { params: {} },
    React,
    options.isRedirect ?? (() => false),
    () => false,
    { shouldHydrate: false },
    false,
    "load",
    [],
    [],
    {},
    (_renderer: unknown, element: unknown) => {
      pageTree = element;
      return { html: "" };
    },
    {},
    (element: unknown) => element,
  );
  return { pageTree };
}

describe("production async page detection", () => {
  it('renders sync components through React even when their source contains "async"', async () => {
    let directCalls = 0;
    function Page() {
      directCalls += 1;
      const submit = async () => {}; // "async" substring in the source
      return React.createElement("main", { onClick: submit }, "sync page");
    }

    const { pageTree } = await runRenderPageElement(Page);

    // The component must not be invoked outside React (hooks would throw and
    // top-level side effects would run twice); it becomes an element type.
    expect(directCalls).toBe(0);
    expect(pageTree.props.children.type).toBe(Page);
  });

  it("still executes genuine async server components to get their element", async () => {
    let calls = 0;
    async function Page() {
      calls += 1;
      return React.createElement("main", null, "async page");
    }

    const { pageTree } = await runRenderPageElement(Page);

    expect(calls).toBe(1);
    expect(pageTree.props.children.type).toBe("main");
  });

  it("propagates errors thrown by async components instead of silently re-rendering", async () => {
    async function Page() {
      throw new Error("boom");
    }

    await expect(runRenderPageElement(Page)).rejects.toThrow("boom");
  });

  it("rethrows redirect control-flow errors from async components", async () => {
    const redirectError = new Error("FARM_REDIRECT");
    async function Page() {
      throw redirectError;
    }

    await expect(
      runRenderPageElement(Page, { isRedirect: (error) => error === redirectError }),
    ).rejects.toBe(redirectError);
  });

  it("never source-sniffs components for the async keyword", () => {
    const universalBuildSource = fs.readFileSync(universalBuildPath, "utf-8");
    const nitroIndexSource = fs.readFileSync(nitroIndexPath, "utf-8");

    expect(universalBuildSource).not.toContain('toString().includes("async")');
    expect(nitroIndexSource).not.toContain('toString().includes("async")');
    expect(nitroIndexSource).toContain(
      'typeof PageComponent === "function" && PageComponent.constructor.name === "AsyncFunction"',
    );
  });
});
