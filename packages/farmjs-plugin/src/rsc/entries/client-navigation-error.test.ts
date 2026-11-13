import { describe, expect, it, vi } from "vitest";
import { localizeFarmHref } from "@farm.js/core/i18n";
import { resolveFarmI18nConfig } from "@farm.js/core/internal/production-runtime";
import { generateClientEntry } from "./client.js";
import type { EntryContext } from "../types.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: undefined,
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "navigation-error-test",
  debug: false,
};

// Rebuild the generated boundary with its free variables supplied as params.
function buildBoundary(deps: { farmNavigateRef: unknown; location: unknown }) {
  const entry = generateClientEntry(context);
  const start = entry.indexOf("class FarmNavigationErrorBoundary extends React.Component {");
  const end = entry.indexOf("async function main() {", start);
  const React = {
    Component: class {
      props: unknown;
      constructor(props: unknown) {
        this.props = props;
      }
    },
  };
  return new Function(
    "React",
    "farmNavigateRef",
    "location",
    `${entry.slice(start, end)}\nreturn FarmNavigationErrorBoundary;`,
  )(React, deps.farmNavigateRef, deps.location);
}

function setup() {
  const navigate = vi.fn();
  const location = { reload: vi.fn() };
  const Boundary = buildBoundary({ farmNavigateRef: { current: navigate }, location });
  return { Boundary, navigate, location };
}

describe("RSC client navigation to a server component that fails", () => {
  it("follows a redirect() as a client navigation to its target", () => {
    const { Boundary, navigate, location } = setup();
    const boundary = new Boundary({ payload: {}, navigated: true });
    boundary.componentDidCatch(
      Object.assign(new Error("redirect"), { digest: "FARM_REDIRECT;307;/next/target?a=1;b" }),
    );
    expect(navigate).toHaveBeenCalledWith("/next/target?a=1;b", "replace");
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("follows a redirect() to its target in the page's locale with i18n", () => {
    const i18n = resolveFarmI18nConfig(
      { locales: ["en", "fr"], defaultLocale: "en" },
      { basePath: "/console" },
    );
    const entry = generateClientEntry({ ...context, basePath: "/console", i18n });
    const helper = entry.slice(
      entry.indexOf("function farmLocalizeRedirect(url) {"),
      entry.indexOf("\n}\n", entry.indexOf("function farmLocalizeRedirect(url) {")) + 3,
    );
    const start = entry.indexOf("class FarmNavigationErrorBoundary extends React.Component {");
    const navigate = vi.fn();
    const Boundary = new Function(
      "React",
      "farmNavigateRef",
      "location",
      "window",
      "localizeFarmHref",
      `${helper}${entry.slice(start, entry.indexOf("async function main() {", start))}
return FarmNavigationErrorBoundary;`,
    )(
      { Component: class {} },
      { current: navigate },
      { reload: vi.fn() },
      // The snapshot a French page under basePath "/console" hydrated with.
      {
        __FARM_I18N__: {
          locale: "fr",
          locales: ["en", "fr"],
          defaultLocale: "en",
          routing: i18n.routing,
          basePath: "/console",
        },
      },
      localizeFarmHref,
    );
    const boundary = new Boundary({ payload: {}, navigated: true });
    boundary.componentDidCatch(
      Object.assign(new Error("redirect"), { digest: "FARM_REDIRECT;307;/about?a=1" }),
    );
    boundary.componentDidCatch(
      Object.assign(new Error("redirect"), { digest: "FARM_REDIRECT;307;https://other.test/" }),
    );
    expect(navigate.mock.calls).toEqual([
      ["/console/fr/about?a=1", "replace"],
      ["https://other.test/", "replace"],
    ]);
  });

  it("loads any other failure as a document, so the server answers with its status", () => {
    const { Boundary, navigate, location } = setup();
    const boundary = new Boundary({ payload: {}, navigated: true });
    boundary.componentDidCatch(Object.assign(new Error("not found"), { digest: "FARM_NOT_FOUND" }));
    boundary.componentDidCatch(new Error("broken page failed"));
    expect(location.reload).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves an error in the first render to React", () => {
    const { Boundary } = setup();
    const error = new Error("hydration failed");
    const first = new Boundary({ payload: {}, navigated: false, children: "page" });
    first.state = { ...first.state, ...Boundary.getDerivedStateFromError(error) };
    expect(() => first.render()).toThrow(error);

    const navigated = new Boundary({ payload: {}, navigated: true, children: "page" });
    navigated.state = { ...navigated.state, ...Boundary.getDerivedStateFromError(error) };
    expect(navigated.render()).toBeNull();
  });

  it("renders the next payload after a failed one", () => {
    const { Boundary } = setup();
    const failed = {};
    const next = {};
    const state = { error: new Error("failed"), payload: failed };
    expect(Boundary.getDerivedStateFromProps({ payload: failed }, state)).toBeNull();
    expect(Boundary.getDerivedStateFromProps({ payload: next }, state)).toEqual({
      error: null,
      payload: next,
    });
  });

  it("wraps the page in the boundary, marking payloads that came from a navigation", () => {
    const entry = generateClientEntry(context);
    expect(entry).toContain("{ payload, navigated: payload !== initial },");
    expect(generateClientEntry({ ...context, actionsEnabled: false })).toContain(
      "class FarmNavigationErrorBoundary extends React.Component {",
    );
  });
});
