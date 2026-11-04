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
  deploymentId: "delegate-test",
  debug: false,
};

/** A slice of the generated entry, from `start` up to `end`, as a function of its free names. */
function extract(entry: string, start: string, end: string, deps: Record<string, unknown>) {
  const from = entry.indexOf(start);
  const to = entry.indexOf(end, from);
  expect(from, start).toBeGreaterThan(-1);
  expect(to, end).toBeGreaterThan(from);
  const names = Object.keys(deps);
  return (source: string) =>
    new Function(...names, `${entry.slice(from, to)}\n${source}`)(...names.map((n) => deps[n]));
}

function browser(href = "https://app.test/notes?tab=1") {
  const url = new URL(href);
  const location = {
    get href() {
      return url.href;
    },
    get origin() {
      return url.origin;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get hash() {
      return url.hash;
    },
    assign: vi.fn(),
  };
  const write = (_state: unknown, _title: string, next: string) => {
    const target = new URL(next, url.href);
    url.href = target.href;
  };
  const history = { pushState: vi.fn(write), replaceState: vi.fn(write) };
  return { location, history };
}

function createNavigate(options: { delegate: (context: any) => boolean | Promise<boolean> }) {
  const { location, history } = browser();
  const refetch = vi.fn(async () => {});
  const runFarmNavigationDelegates = vi.fn(async (ctx: unknown) => options.delegate(ctx));
  const navigate = extract(
    generateClientEntry(context),
    "async function navigate(href, action) {",
    "farmNavigateRef.current = navigate;",
    { location, history, refetch, runFarmNavigationDelegates, URL },
  )("return navigate;") as (href: string, action: "push" | "replace") => Promise<void>;
  return { navigate, location, history, refetch, runFarmNavigationDelegates };
}

describe("the RSC router offers in-app navigations to navigation delegates", () => {
  it("leaves the page and URL alone when a delegate takes the navigation", async () => {
    const run = createNavigate({ delegate: () => true });
    await run.navigate("/notes/2", "push");
    expect(run.runFarmNavigationDelegates).toHaveBeenCalledWith({
      url: "https://app.test/notes/2",
      from: "/notes?tab=1",
      to: "/notes/2",
      action: "push",
    });
    expect(run.history.pushState).not.toHaveBeenCalled();
    expect(run.history.replaceState).not.toHaveBeenCalled();
    expect(run.refetch).not.toHaveBeenCalled();
    expect(run.location.href).toBe("https://app.test/notes?tab=1");
  });

  it("pushes or replaces history and renders when every delegate declines", async () => {
    const push = createNavigate({ delegate: () => false });
    await push.navigate("/about#team", "push");
    expect(push.history.pushState).toHaveBeenCalledWith(null, "", "https://app.test/about#team");
    expect(push.refetch).toHaveBeenCalledWith("https://app.test/about#team");

    const replace = createNavigate({ delegate: () => false });
    await replace.navigate("/about", "replace");
    expect(replace.runFarmNavigationDelegates.mock.calls[0]?.[0]).toMatchObject({
      action: "replace",
    });
    expect(replace.history.replaceState).toHaveBeenCalledWith(null, "", "https://app.test/about");
    expect(replace.history.pushState).not.toHaveBeenCalled();
  });

  it("does not offer same-page moves, and loads other origins as documents", async () => {
    const samePage = createNavigate({ delegate: () => true });
    await samePage.navigate("/notes?tab=1#top", "push");
    expect(samePage.runFarmNavigationDelegates).not.toHaveBeenCalled();
    expect(samePage.refetch).toHaveBeenCalled();

    const external = createNavigate({ delegate: () => true });
    await external.navigate("https://elsewhere.example/x", "push");
    expect(external.runFarmNavigationDelegates).not.toHaveBeenCalled();
    expect(external.location.assign).toHaveBeenCalledWith("https://elsewhere.example/x");
    expect(external.history.pushState).not.toHaveBeenCalled();
  });

  it("navigates a link click through the delegates, as push or as Link replace", () => {
    const navigate = vi.fn();
    const { location } = browser();
    const handleClick = extract(
      generateClientEntry(context),
      "const handleClick = (e) => {",
      "document.addEventListener('click', handleClick, true);",
      { navigate, location, nav: vi.fn() },
    )("return handleClick;") as (event: unknown) => void;
    const click = (attributes: string[]) => {
      const anchor = {
        href: "https://app.test/notes/3",
        origin: "https://app.test",
        pathname: "/notes/3",
        search: "",
        hash: "",
        download: false,
        target: "",
        hasAttribute: (name: string) => attributes.includes(name),
      };
      const event = {
        target: { closest: () => anchor },
        button: 0,
        preventDefault: vi.fn(),
      };
      handleClick(event);
      return event;
    };
    expect(click([]).preventDefault).toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith("https://app.test/notes/3", "push");
    click(["data-farm-link", "data-replace"]);
    expect(navigate).toHaveBeenLastCalledWith("https://app.test/notes/3", "replace");
    // data-native and data-reload links stay document navigations.
    navigate.mockClear();
    expect(click(["data-reload"]).preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("hands a redirect from a server action to the same navigation", async () => {
    const entry = generateClientEntry(context);
    let callback: ((id: string, args: unknown[]) => Promise<unknown>) | undefined;
    const farmNavigateRef = { current: vi.fn(async () => {}) };
    const { history } = browser();
    extract(entry, "setServerCallback(async (id, args) => {", "\n});\n", {
      setServerCallback: (fn: typeof callback) => (callback = fn),
      debug: () => {},
      beginFarmServerQueryAction: () => ({}),
      completeFarmServerQueryAction: () => undefined,
      shouldApplyFarmServerQueryActionResult: () => false,
      createTemporaryReferenceSet: () => ({}),
      encodeReply: async () => "[]",
      createFarmDeploymentRequestHeaders: () => new Headers(),
      farmDeploymentId: "delegate-test",
      isFarmDeploymentMismatchResponse: () => false,
      reportDeploymentMismatch: () => {},
      fetch: async () => ({ ok: true, body: {} }),
      createFromReadableStream: async () => ({
        root: null,
        returnValue: { ok: false, redirect: { url: "/notes/9" } },
      }),
      setPayloadRef: { current: null },
      applyFarmCacheInvalidations: () => {},
      farmNavigateRef,
      history,
      location: { href: "https://app.test/notes/new" },
      createFarmServerFnTransportError: () => new Error("failed"),
    })("});");
    await callback!("action-id", []);
    expect(farmNavigateRef.current).toHaveBeenCalledWith("/notes/9", "push");
    expect(history.pushState).not.toHaveBeenCalled();
  });
});

describe("the RSC browser entry and the mobile shell", () => {
  it("hands navigations to the shell from the browser entry only under farm dev --mobile", () => {
    expect(generateClientEntry(context)).not.toContain("installFarmMobileShellNavigation");
    expect(generateClientEntry({ ...context, mobileClient: "entry" })).not.toContain(
      "installFarmMobileShellNavigation",
    );
    const inline = generateClientEntry({ ...context, mobileClient: "inline" });
    expect(inline).toContain(
      "import { installFarmMobileShellNavigation } from '@farm.js/core/internal/client-runtime';\ninstallFarmMobileShellNavigation();",
    );
  });
});
