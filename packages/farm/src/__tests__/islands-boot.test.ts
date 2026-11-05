import { afterEach, describe, expect, it, vi } from "vitest";
import { FARM_ISLAND_REPLAYABLE_SELECTOR } from "../island";
import {
  FARM_ISLANDS_BOOT_REPLAYABLE_SELECTOR,
  FARM_ISLANDS_BOOT_VISIBLE_MARGIN,
  startFarmIslandsBoot,
} from "../client/islands-boot";
import { observeIslandVisibility } from "../client/island-triggers";

type QueueWindow = Window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown[] };

let finishLoad: (() => void) | undefined;
let started: ReturnType<typeof vi.fn> | undefined;

/** Starts the boot with a runtime load that stays pending until the test finishes it. */
function boot(html: string) {
  document.body.innerHTML = html;
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishLoad = resolve;
      }),
  );
  started = load;
  startFarmIslandsBoot(load);
  return load;
}

async function settle() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

/** Clicks `target`; true when something on the page (the boot) prevented the default. */
function click(target: Element): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  let prevented: boolean | undefined;
  // Window listeners run after the document's, where the boot listens. jsdom cannot navigate or
  // submit, so the default is stopped there once the result is read. A click the boot holds stops
  // propagating before it gets there.
  const read = (seen: Event) => {
    prevented = seen.defaultPrevented;
    seen.preventDefault();
  };
  window.addEventListener("click", read);
  target.dispatchEvent(event);
  window.removeEventListener("click", read);
  return prevented ?? event.defaultPrevented;
}

afterEach(async () => {
  // Every boot ends released, so its listeners never reach the next test.
  if (started && started.mock.calls.length === 0) {
    document.body.innerHTML = '<a href="/end">end</a>';
    document.querySelector("a")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  }
  finishLoad?.();
  await settle();
  finishLoad = undefined;
  started = undefined;
  delete (window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("startFarmIslandsBoot", () => {
  it("holds the same targets and watches with the same margin as the island scheduler", () => {
    expect(FARM_ISLANDS_BOOT_REPLAYABLE_SELECTOR).toBe(FARM_ISLAND_REPLAYABLE_SELECTOR);
    let margin: string | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_callback: unknown, options?: IntersectionObserverInit) {
          margin = options?.rootMargin;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const target = document.createElement("div");
    observeIslandVisibility(document, [target], () => {})();
    expect(margin).toBe(FARM_ISLANDS_BOOT_VISIBLE_MARGIN);
  });

  it("loads the runtime at once for an island that hydrates at load", () => {
    const load = boot('<f-island strategy="load"><button type="button">Add</button></f-island>');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads the runtime at once for a boundary the browser has to render", () => {
    const load = boot("<!--$!--><p>fallback</p><!--/$-->");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("waits for an interaction island, then holds its click for the runtime to replay", async () => {
    const load = boot(
      '<f-island strategy="interaction"><button type="button">Add</button></f-island>',
    );
    expect(load).not.toHaveBeenCalled();
    const button = document.querySelector("button")!;
    const announced = vi.fn();
    document.addEventListener("farm:island-interaction", announced);
    const held = click(button);
    document.removeEventListener("farm:island-interaction", announced);
    expect(held).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect((window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__).toEqual([
      expect.objectContaining({ target: button, kind: "click" }),
    ]);
    expect(announced).toHaveBeenCalledTimes(1);
    // Once the runtime runs, its scheduler holds clicks; the boot lets them through.
    finishLoad!();
    await settle();
    expect(click(button)).toBe(false);
  });

  it("leaves clicks and submits outside islands alone, and starts on a form's focus", () => {
    const load = boot(
      '<f-island strategy="interaction"></f-island>' +
        '<form><input name="q"><button type="submit">Search</button></form>',
    );
    const form = document.querySelector("form")!;
    expect(click(document.querySelector("button")!)).toBe(false);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
    expect(load).not.toHaveBeenCalled();
    document.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("holds a link click until the runtime runs, then clicks the link again", async () => {
    const load = boot('<f-island strategy="interaction"></f-island><a href="/next">Next</a>');
    const anchor = document.querySelector("a")!;
    const replayed = vi.fn((event: Event) => event.preventDefault());
    expect(click(anchor)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    document.addEventListener("click", replayed);
    finishLoad!();
    await settle();
    document.removeEventListener("click", replayed);
    expect(replayed).toHaveBeenCalledTimes(1);
    expect(replayed.mock.calls[0]![0].target).toBe(anchor);
  });

  it("leaves links the router does not take to the browser", () => {
    const load = boot(
      '<f-island strategy="interaction"></f-island>' +
        '<a href="https://example.com/">Out</a><a href="#top">Top</a>' +
        '<a href="/file.pdf" download>File</a><a href="/tab" target="_blank">Tab</a>',
    );
    for (const anchor of Array.from(document.querySelectorAll("a"))) {
      expect(click(anchor)).toBe(false);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("starts loading when a pointer moves over a link", () => {
    const load = boot('<f-island strategy="interaction"></f-island><a href="/next">Next</a>');
    document.querySelector("a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
