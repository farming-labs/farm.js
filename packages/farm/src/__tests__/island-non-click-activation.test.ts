import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleFarmIslandHydration } from "../client/island-runtime";
import { FARM_ISLAND_ACTIVATION_EVENTS } from "../island";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("deferred island activation beyond clicks", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="island"><form id="form"><input name="q" type="text" /></form></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown })
      .__FARM_PREHYDRATION_CLICK_QUEUE__;
    document.body.innerHTML = "";
  });

  it("hydrates and replays a submit from a form with no button", async () => {
    // The regression: pressing Enter in the only field fires submit, not click,
    // so the island never hydrated and the submit was lost outright.
    const container = document.getElementById("island")!;
    const form = document.getElementById("form") as HTMLFormElement;
    const submitted = vi.fn();
    const hydrate = vi.fn(() => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitted();
      });
      return "hydrated";
    });

    const scheduled = scheduleFarmIslandHydration({ container, strategy: "interaction", hydrate });
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await expect(scheduled).resolves.toBe("hydrated");
    expect(hydrate).toHaveBeenCalledTimes(1);
    await flush();
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("prevents the original submit so the browser does not navigate first", async () => {
    const container = document.getElementById("island")!;
    const form = document.getElementById("form") as HTMLFormElement;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => "hydrated",
    });

    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await scheduled;
  });

  it("starts hydration on focus without swallowing the interaction", async () => {
    // Typing must not be intercepted or replayed, so the only safe help is to
    // begin hydrating at focus, before the value can diverge.
    const container = document.getElementById("island")!;
    const input = container.querySelector("input")!;
    const hydrate = vi.fn(() => "hydrated");

    const scheduled = scheduleFarmIslandHydration({ container, strategy: "interaction", hydrate });
    const event = new FocusEvent("focusin", { bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    await expect(scheduled).resolves.toBe("hydrated");
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("starts hydration on pointerdown without swallowing it", async () => {
    const container = document.getElementById("island")!;
    const input = container.querySelector("input")!;
    const hydrate = vi.fn(() => "hydrated");

    const scheduled = scheduleFarmIslandHydration({ container, strategy: "interaction", hydrate });
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    await expect(scheduled).resolves.toBe("hydrated");
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not replay a click on an element that was only focused", async () => {
    // An observed interaction carries no replay kind. Synthesizing a click on a
    // focused text field would be an interaction the user never made.
    const container = document.getElementById("island")!;
    const input = container.querySelector("input")!;
    const clicked = vi.fn();
    input.addEventListener("click", clicked);

    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => "hydrated",
    });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    await scheduled;
    await flush();
    expect(clicked).not.toHaveBeenCalled();
  });

  it("ignores interactions outside the container", async () => {
    document.body.insertAdjacentHTML("beforeend", '<form id="outside"></form>');
    const container = document.getElementById("island")!;
    const outside = document.getElementById("outside") as HTMLFormElement;
    const hydrate = vi.fn(() => "hydrated");

    scheduleFarmIslandHydration({ container, strategy: "interaction", hydrate });
    outside.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(hydrate).not.toHaveBeenCalled();
  });

  it("claims a submit captured by the inline pre-hydration queue", async () => {
    // The inline script runs before this module loads, so a submit it held has
    // to be recognized here, including its kind.
    const container = document.getElementById("island")!;
    const form = document.getElementById("form") as HTMLFormElement;
    const submitted = vi.fn();
    (
      window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown[] }
    ).__FARM_PREHYDRATION_CLICK_QUEUE__ = [{ target: form, kind: "submit" }];

    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          submitted();
        });
        return "hydrated";
      },
    });

    await expect(scheduled).resolves.toBe("hydrated");
    await flush();
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("treats a queue entry with no kind as a click, for older documents", async () => {
    document.body.innerHTML = '<div id="island"><button type="button">Copy</button></div>';
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    const clicked = vi.fn();
    (
      window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown[] }
    ).__FARM_PREHYDRATION_CLICK_QUEUE__ = [{ target: button }];

    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => {
        button.addEventListener("click", clicked);
        return "hydrated";
      },
    });

    await expect(scheduled).resolves.toBe("hydrated");
    await flush();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("declares every activation event it listens to", () => {
    expect([...FARM_ISLAND_ACTIVATION_EVENTS]).toEqual([
      "click",
      "submit",
      "pointerdown",
      "focusin",
    ]);
  });
});

describe("inline pre-hydration script", () => {
  it("registers a listener for every shared activation event", async () => {
    // The inline script runs before any bundle loads, and the island runtime
    // takes over afterwards. If the two disagree about which events activate a
    // boundary, an interaction is either swallowed with no hydration to follow
    // or never captured at all.
    const { createPreHydrationClickQueueScript } = await import("../server/renderer");
    const script = createPreHydrationClickQueueScript();

    for (const type of FARM_ISLAND_ACTIVATION_EVENTS) {
      expect(script).toContain(`addEventListener("${type}"`);
    }
  });

  it("holds clicks and submits but only observes the rest", async () => {
    const { createPreHydrationClickQueueScript } = await import("../server/renderer");
    const script = createPreHydrationClickQueueScript();

    // Held interactions are queued with a kind so the runtime can reproduce them.
    expect(script).toContain('hold(event,target,"click")');
    expect(script).toContain('hold(event,form,"submit")');
    // Observed ones announce with a null kind and never call preventDefault.
    expect(script).toContain("announce(target,null)");
  });
});

describe("real browser event ordering", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="island"><button type="button" data-testid="dismiss">dismiss me</button></div>';
  });

  afterEach(() => {
    delete (window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown })
      .__FARM_PREHYDRATION_CLICK_QUEUE__;
    document.body.innerHTML = "";
  });

  it("still replays the click when pointerdown starts hydration first", async () => {
    // A mouse click fires pointerdown, then focusin, then click. The observed
    // events start hydration, so the click that follows must still be held:
    // dropping the capture listeners at start() loses the user's actual click.
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    const clicked = vi.fn();
    const hydrate = vi.fn(() => {
      button.addEventListener("click", clicked);
      return "hydrated";
    });

    const scheduled = scheduleFarmIslandHydration({ container, strategy: "interaction", hydrate });

    button.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    button.dispatchEvent(click);

    await expect(scheduled).resolves.toBe("hydrated");
    expect(hydrate).toHaveBeenCalledTimes(1);
    // The real click is held rather than reaching a half-hydrated tree.
    expect(click.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("holds a click that arrives while hydration is still in flight", async () => {
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    const clicked = vi.fn();
    let release: (() => void) | undefined;
    const hydrate = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => {
            button.addEventListener("click", clicked);
            resolve("hydrated");
          };
        }),
    );

    const scheduled = scheduleFarmIslandHydration({ container, strategy: "interaction", hydrate });
    button.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Chunk has not resolved yet; the user clicks now.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    button.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    release?.();
    await expect(scheduled).resolves.toBe("hydrated");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
