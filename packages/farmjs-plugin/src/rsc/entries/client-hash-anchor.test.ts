import { describe, expect, it, vi } from "vitest";
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
  deploymentId: "hash-test",
  debug: false,
};

// Pull the generated click handler out of the client entry and rebuild it with
// its three free variables (location, history, nav) supplied as parameters.
function buildHandleClick(location: any, history: any, nav: () => void) {
  const entry = generateClientEntry(context);
  const start = entry.indexOf("const handleClick = (e) => {");
  const end = entry.indexOf("document.addEventListener('click', handleClick", start);
  const source = entry.slice(start, end).trim().replace(/;?$/, "");
  return new Function("location", "history", "nav", `${source}\nreturn handleClick;`)(
    location,
    history,
    nav,
  );
}

function clickEvent(anchor: Record<string, unknown>) {
  return {
    target: { closest: () => anchor },
    preventDefault: vi.fn(),
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    button: 0,
  };
}

const anchor = (over: Record<string, unknown>) => ({
  href: "https://app.test/",
  origin: "https://app.test",
  pathname: "/",
  search: "",
  hash: "",
  download: "",
  target: "",
  hasAttribute: () => false,
  ...over,
});

describe("RSC client navigation and same-document fragment links", () => {
  const location = {
    origin: "https://app.test",
    pathname: "/docs",
    search: "",
    href: "https://app.test/docs",
  };

  it("lets the browser handle a pure fragment link without refetching", () => {
    const history = { pushState: vi.fn() };
    const nav = vi.fn();
    const handleClick = buildHandleClick(location, history, nav);

    const event = clickEvent(
      anchor({
        href: "https://app.test/docs#usage",
        pathname: "/docs",
        search: "",
        hash: "#usage",
      }),
    );
    handleClick(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(history.pushState).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it("still intercepts navigation to a different route that carries a hash", () => {
    const history = { pushState: vi.fn() };
    const nav = vi.fn();
    const handleClick = buildHandleClick(location, history, nav);

    const event = clickEvent(
      anchor({
        href: "https://app.test/guide#intro",
        pathname: "/guide",
        search: "",
        hash: "#intro",
      }),
    );
    handleClick(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(history.pushState).toHaveBeenCalledWith(null, "", "https://app.test/guide#intro");
    expect(nav).toHaveBeenCalled();
  });
});
