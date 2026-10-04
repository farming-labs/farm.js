import { createSignal, createUniqueId, sharedConfig } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as clientRuntime from "../client";
import { UNIQUE_ID_ISLAND_HTML } from "./unique-id-island.fixture";

interface SolidHydrationBootstrap {
  events: Array<[Element, Event]> | null;
  completed: WeakSet<Element>;
  r: Record<string, unknown>;
  fe(): void;
}

declare global {
  // eslint-disable-next-line no-var
  var _$HY: SolidHydrationBootstrap | undefined;
}

// Compiles to the ssr() shape in renderer.test.ts, which renders the fixture.
function UniqueIdIsland() {
  const id = createUniqueId();
  const [count, setCount] = createSignal(0);
  return (
    <button type="button" id={id} onClick={() => setCount(count() + 1)}>
      count: {count()}
    </button>
  );
}

let removeBootstrap: (() => void) | undefined;

// Mirrors generateHydrationScript(), which production documents include: it
// queues every click whose nearest data-hk element has not hydrated yet. The
// inline script runs before Solid delegates events, so listen in the capture
// phase to keep that order.
function installSolidHydrationScript(): SolidHydrationBootstrap {
  const bootstrap: SolidHydrationBootstrap = {
    events: [],
    completed: new WeakSet(),
    r: {},
    fe() {},
  };
  const queue = (event: Event) => {
    if (!bootstrap.events) return;
    const owner = (event.target as Element).closest("[data-hk]");
    if (owner && !bootstrap.completed.has(owner)) bootstrap.events.push([owner, event]);
  };
  document.addEventListener("click", queue, true);
  removeBootstrap = () => document.removeEventListener("click", queue, true);
  globalThis._$HY = bootstrap;
  Object.assign(window, { _$HY: bootstrap });
  return bootstrap;
}

function mountServerHtml(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild as HTMLElement;
}

describe("Solid island hydration", () => {
  beforeEach(() => {
    installSolidHydrationScript();
  });

  afterEach(() => {
    removeBootstrap?.();
    document.body.replaceChildren();
    const config = sharedConfig as typeof sharedConfig & Record<string, unknown>;
    config.done = false;
    config.events = config.completed = config.registry = undefined;
  });

  it("hydrates an island whose root creates an id before its first element", () => {
    const container = mountServerHtml(UNIQUE_ID_ISLAND_HTML);
    const serverButton = container.querySelector("button")!;

    const root = clientRuntime.hydrateRoot(container, clientRuntime.createElement(UniqueIdIsland));

    const button = container.querySelector("button")!;
    expect(button).toBe(serverButton);
    button.click();
    expect(button.textContent).toBe("count: 1");

    root.unmount();
  });

  it("keeps an island interactive when hydration falls back to a client render", () => {
    // Without the server's render id the inferred id misses, so FARMJS
    // renders the island again instead of claiming the server nodes.
    const container = mountServerHtml(
      UNIQUE_ID_ISLAND_HTML.replace(' data-farm-solid-render-id="0"', ""),
    );
    container.querySelector("button")!.click();

    const root = clientRuntime.hydrateRoot(container, clientRuntime.createElement(UniqueIdIsland));

    expect(globalThis._$HY?.events).toHaveLength(0);
    const button = container.querySelector("button")!;
    button.click();
    button.click();
    expect(button.textContent).toBe("count: 2");

    root.unmount();
  });
});
