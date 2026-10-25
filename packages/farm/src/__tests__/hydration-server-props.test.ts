// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, it } from "vitest";

// Both client entries are emitted as template literals, so these tests run the
// emitted source for the initial page props against stubs.

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", file), "utf8");
}

function extractBlock(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated function: ${signature}`);
}

function serverDocumentProps(params: Record<string, string>) {
  // The JSON shape the server embeds as window.__FARM_PROPS__.
  return JSON.parse(
    JSON.stringify({
      params,
      search: { url: "https://example.com" },
      searchParams: { url: "https://example.com" },
      path: "/check",
      middleware: { data: { report: "SERVER_REPORT" } },
    }),
  );
}

describe("development client initial page props", () => {
  const source = readSource("vite.ts");
  const hydrateBody = extractBlock(source, "async function hydrate() {");
  const start = hydrateBody.indexOf("let pageProps = normalizeServerProps(window.__FARM_PROPS__);");
  // Only the props logic runs here; the hydration gates before it need a DOM.
  const gates = extractBlock(hydrateBody.slice(start), "if (!modulePath) {");
  const propsStart = hydrateBody.indexOf(gates, start) + gates.length;
  const end = hydrateBody.indexOf("currentPageProps = pageProps;", propsStart);
  const resolveProps =
    "let pageProps = normalizeServerProps(window.__FARM_PROPS__);" +
    hydrateBody.slice(propsStart, end);

  function initialProps(rawProps: unknown, route: { params: Record<string, string> } | null) {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const run = new Function(
      "window",
      "findRoute",
      "getCurrentSearchParams",
      `${extractBlock(source, "function normalizeServerProps(rawProps) {")}
${resolveProps}
return pageProps;`,
    );
    return run(
      { __FARM_PROPS__: rawProps, location: { pathname: "/check" } },
      () => route,
      () => ({ url: "https://example.com" }),
    );
  }

  it("keeps middleware data on a route without params", () => {
    const props = initialProps(serverDocumentProps({}), { params: {} });

    expect(props.middleware.data).toBeInstanceOf(Map);
    expect(props.middleware.data.get("report")).toBe("SERVER_REPORT");
    expect(props.params).toEqual({});
    expect(props.path).toBe("/check");
  });

  it("keeps middleware data on a route with params", () => {
    const props = initialProps(serverDocumentProps({ id: "7" }), { params: { id: "7" } });

    expect(props.params).toEqual({ id: "7" });
    expect(props.middleware.data.get("report")).toBe("SERVER_REPORT");
  });

  it("takes params, search, and path from the URL when the document carries none", () => {
    const props = initialProps(undefined, { params: { id: "7" } });

    expect(props).toEqual({
      params: { id: "7" },
      search: { url: "https://example.com" },
      searchParams: { url: "https://example.com" },
      path: "/check",
    });
  });

  it("hydrates a client navigation with middleware data as a Map", () => {
    const renderPage = extractBlock(source, "async function renderPage(pageData) {");
    const revive = renderPage.match(
      /const (\w+) = pageData\.props \? normalizeServerProps\(pageData\.props\)/,
    );
    // The props argument of each tryHydrateImportedPage(container, route, params, layouts, mode, props, ...).
    const propsArguments = renderPage
      .split("tryHydrateImportedPage(")
      .slice(1)
      .map((call) => call.split(",")[5]?.trim());

    expect(revive).not.toBeNull();
    expect(propsArguments).toHaveLength(2);
    expect(propsArguments).toEqual([revive![1], revive![1]]);
  });
});

describe("production client page props", () => {
  const source = readSource(path.join("nitro", "universal-build.ts"));

  async function hydrationProps(
    serverProps: unknown,
    params: Record<string, string>,
    searchParams: Record<string, string> = { url: "https://example.com" },
  ) {
    let received: any;
    function Page(props: any) {
      received = props;
      return null;
    }
    const run = new Function(
      "React",
      "hasHydratableLayout",
      "loadRouteComponent",
      "createFarmRouteState",
      "matched",
      "searchParams",
      "serverProps",
      `${extractBlock(source, "function reviveServerPageProps(serverProps) {")}
${extractBlock(source, "async function createMatchedHydrationRoute(")}
return createMatchedHydrationRoute(matched, "/check", searchParams, undefined, serverProps);`,
    );
    const state = await run(
      React,
      () => false,
      async (route: any) => route.Component,
      (page: any) => ({ page }),
      { route: { pageShouldHydrate: true, Component: Page }, params },
      searchParams,
      serverProps,
    );
    // Render the element the way React would, to read the props it carries.
    state.page.type(state.page.props);
    return received;
  }

  it("hydrates a route without params with the server's middleware data", async () => {
    const props = await hydrationProps(serverDocumentProps({}), {});

    expect(props.middleware.data).toBeInstanceOf(Map);
    expect(props.middleware.data.get("report")).toBe("SERVER_REPORT");
    expect(props.params).toEqual({});
    await expect(props.searchParams).resolves.toEqual({ url: "https://example.com" });
  });

  it("uses the URL's params and search over the document's", async () => {
    const props = await hydrationProps(
      serverDocumentProps({ id: "stale" }),
      { id: "7" },
      { q: "1" },
    );

    expect(props.params).toEqual({ id: "7" });
    await expect(props.searchParams).resolves.toEqual({ q: "1" });
    expect(props.middleware.data.get("report")).toBe("SERVER_REPORT");
  });

  it("renders from the URL alone when a fetched document had no props", async () => {
    const props = await hydrationProps(undefined, { id: "7" });

    expect(props.params).toEqual({ id: "7" });
    expect(props.middleware).toBeUndefined();
  });
});
