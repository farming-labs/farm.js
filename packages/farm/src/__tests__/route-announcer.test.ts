// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientPluginManager } from "../client/plugin";
import { createPluginlessClientRuntime } from "../client/pluginless-runtime";
import {
  createFarmRouteAnnouncer,
  FARM_ROUTE_ANNOUNCEMENT_DELAY_MS,
  FARM_ROUTE_ANNOUNCER_ID,
} from "../client/route-announcer";

function region(): HTMLElement | null {
  return document.getElementById(FARM_ROUTE_ANNOUNCER_ID);
}

function visit(path: string, title: string, body = "") {
  window.history.pushState(null, "", path);
  document.title = title;
  document.body.innerHTML = body;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  document.title = "Home";
  document.body.innerHTML = "<h1>Home</h1>";
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("createFarmRouteAnnouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("adds nothing to the page until a navigation changes it", () => {
    const announce = createFarmRouteAnnouncer();
    expect(region()).toBeNull();

    // The initial load, a hash change, and a refresh that keeps the path and title.
    announce();
    window.history.pushState(null, "", "/#section");
    announce();
    vi.runAllTimers();
    expect(region()).toBeNull();
  });

  it("announces the new title in a visually hidden assertive live region", () => {
    const announce = createFarmRouteAnnouncer();
    visit("/about", "About us", "<h1>About</h1>");
    announce();

    const live = region()!;
    expect(live.getAttribute("aria-live")).toBe("assertive");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    expect(live.style.position).toBe("absolute");
    expect(live.style.width).toBe("1px");
    expect(live.style.overflow).toBe("hidden");
    // Empty first: the region exists before its text changes.
    expect(live.textContent).toBe("");

    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(live.textContent).toBe("About us");
    expect(document.body.lastElementChild).toBe(live);
  });

  it("falls back to the first h1, then the pathname", () => {
    const announce = createFarmRouteAnnouncer();
    visit("/docs", "  ", "<main><h1> Getting started </h1><h1>Second</h1></main>");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("Getting started");

    visit("/blank", "", "<p>No heading</p>");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("/blank");
  });

  it("announces a new path with the same title, and a new title on the same path", () => {
    const announce = createFarmRouteAnnouncer();
    visit("/posts/1", "Blog");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("Blog");

    visit("/posts/2", "Blog");
    announce();
    // Cleared, so the same words are a change a screen reader reads again.
    expect(region()?.textContent).toBe("");
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("Blog");

    visit("/posts/2?page=2", "Blog, page 2");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("Blog, page 2");
  });

  it("skips a search change that keeps the title", () => {
    const announce = createFarmRouteAnnouncer();
    visit("/products", "Products");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    region()!.textContent = "read";

    window.history.pushState(null, "", "/products?sort=price");
    announce();
    vi.runAllTimers();
    expect(region()?.textContent).toBe("read");
  });

  it("announces Back to the page the document loaded with", () => {
    const announce = createFarmRouteAnnouncer();
    visit("/about", "About us");
    announce();
    visit("/", "Home");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("Home");
  });

  it("announces only the latest of navigations that land within the delay", () => {
    const announce = createFarmRouteAnnouncer();
    visit("/a", "Page A");
    announce();
    visit("/b", "Page B");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("Page B");
    expect(document.querySelectorAll(`#${FARM_ROUTE_ANNOUNCER_ID}`)).toHaveLength(1);
  });

  it("creates the region again when a navigation replaced the body", () => {
    const announce = createFarmRouteAnnouncer();
    visit("/a", "Page A");
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);

    visit("/b", "Page B", "<h1>B</h1>");
    expect(region()).toBeNull();
    announce();
    vi.advanceTimersByTime(FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
    expect(region()?.textContent).toBe("Page B");
  });

  it("does nothing without a document", () => {
    const announce = createFarmRouteAnnouncer({} as Window);
    visit("/a", "Page A");
    announce();
    vi.runAllTimers();
    expect(region()).toBeNull();
  });
});

describe.each([
  ["plugin manager", () => createClientPluginManager([], { router: {} as never, window })],
  ["pluginless runtime", () => createPluginlessClientRuntime()],
])("client runtime announcements: %s", (_name, create) => {
  const input = { to: "http://localhost/next", action: "push" } as never;

  it("announces a navigation once it has rendered", async () => {
    const runtime = create();
    const session = await runtime.beginNavigation(input);
    visit("/next", "Next page", "<h1>Next</h1>");
    await runtime.scheduleNavigationRendered(session);
    expect(region()?.textContent).toBe("");
    await vi.waitFor(() => expect(region()?.textContent).toBe("Next page"));
  });

  it("does not announce a navigation that was superseded", async () => {
    const runtime = create();
    const session = await runtime.beginNavigation(input);
    visit("/next", "Next page");
    const rendered = runtime.scheduleNavigationRendered(session);
    runtime.cancelNavigation(session, "superseded");
    await rendered;
    expect(region()).toBeNull();
  });

  it("does not announce a refresh of the page on screen", async () => {
    const runtime = create();
    const session = await runtime.beginNavigation(input);
    await runtime.scheduleNavigationRendered(session);
    expect(region()).toBeNull();
  });
});

describe("a plugin manager whose entry announces its own navigations", () => {
  it("runs navigation.rendered without announcing", async () => {
    const rendered = vi.fn();
    const runtime = createClientPluginManager(
      [{ name: "recorder", definition: { navigation: { rendered } } }],
      { router: {} as never, window, announceRoutes: false },
    );
    const session = await runtime.beginNavigation({ to: "http://localhost/next", action: "push" });
    visit("/next", "Next page", "<h1>Next</h1>");
    await runtime.scheduleNavigationRendered(session);
    expect(rendered).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, FARM_ROUTE_ANNOUNCEMENT_DELAY_MS * 2));
    expect(region()).toBeNull();
  });
});
