/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { FarmClientPluginManager } from "../client/plugin";

function createManager() {
  const closed: string[] = [];

  const manager = new FarmClientPluginManager(
    [
      {
        name: "test:lifecycle",
        definition: {
          setup() {},
          close({ reason }: { reason: string }) {
            closed.push(reason);
          },
        },
      } as never,
    ],
    { isDev: false } as never,
  );

  return { manager, closed };
}

/** Dispatch a pagehide the way a browser does, with the persisted flag set. */
function dispatchPageHide(persisted: boolean) {
  const event = new Event("pagehide") as Event & { persisted?: boolean };
  Object.defineProperty(event, "persisted", { value: persisted, configurable: true });
  window.dispatchEvent(event);
}

describe("client plugins and the back/forward cache", () => {
  it("keeps plugins alive when the page enters the bfcache", async () => {
    const { manager, closed } = createManager();
    await manager.start();

    dispatchPageHide(true);
    await vi.waitFor(() => expect(closed).toEqual([]));

    // A restored page must still have working plugins.
    expect(closed).toEqual([]);
    manager.close("manual");
  });

  it("still tears down on a real unload", async () => {
    const { manager, closed } = createManager();
    await manager.start();

    dispatchPageHide(false);
    await vi.waitFor(() => expect(closed).toEqual(["pagehide"]));
  });

  it("tears down on an unload that follows a bfcache entry", async () => {
    const { manager, closed } = createManager();
    await manager.start();

    // Entering the bfcache must not consume the listener.
    dispatchPageHide(true);
    await vi.waitFor(() => expect(closed).toEqual([]));

    dispatchPageHide(false);
    await vi.waitFor(() => expect(closed).toEqual(["pagehide"]));
  });

  it("does not close twice when pagehide repeats", async () => {
    const { manager, closed } = createManager();
    await manager.start();

    dispatchPageHide(false);
    await vi.waitFor(() => expect(closed).toEqual(["pagehide"]));
    dispatchPageHide(false);
    await vi.waitFor(() => expect(closed).toEqual(["pagehide"]));
  });
});
