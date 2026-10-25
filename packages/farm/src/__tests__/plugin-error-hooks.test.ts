// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginManager, type FarmPlugin } from "../plugin";

const event = { phase: "test", error: new Error("original failure") };
const createManager = (isDev = true) => new PluginManager({ config: {}, isDev, isProd: !isDev });
afterEach(() => vi.restoreAllMocks());

describe("plugin error hook isolation", () => {
  it("invokes later reporters after a synchronous failure, preserving context and this", async () => {
    const manager = createManager();
    const failure = new Error("reporter failed");
    const observed: unknown[] = [];
    manager.addPlugin({
      name: "broken",
      onError() {
        throw failure;
      },
    });
    const later: FarmPlugin = {
      name: "later",
      onError(payload, context) {
        observed.push(this, payload, context.isDev);
      },
    };
    manager.addPlugin(later);
    await expect(manager.runHookParallel("onError", event)).rejects.toBe(failure);
    expect(observed).toEqual([later, event, true]);
  });

  it.each([true, false])(
    "awaits pending reporters when the failing reporter is first: %s",
    async (first) => {
      const manager = createManager();
      const release = Promise.withResolvers<void>();
      const entered = Promise.withResolvers<void>();
      const failure = new Error("reporter failed");
      const calls: string[] = [];
      const broken: FarmPlugin = {
        name: "broken",
        async onError() {
          throw failure;
        },
      };
      const slow: FarmPlugin = {
        name: "slow",
        async onError() {
          calls.push("started");
          entered.resolve();
          await release.promise;
          calls.push("finished");
        },
      };
      manager.addPlugins(first ? [broken, slow] : [slow, broken]);
      let settled = false;
      const result = manager.runHookParallel("onError", event).then(
        () => {
          settled = true;
        },
        (error) => {
          settled = true;
          return error;
        },
      );
      try {
        await entered.promise;
        // Drain already-queued rejection handlers without releasing the reporter.
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
        expect(calls).toEqual(["started"]);
      } finally {
        release.resolve();
        await result;
      }
      expect(await result).toBe(failure);
      expect(calls).toEqual(["started", "finished"]);
    },
  );

  it("retains the first observed rejection while consuming later rejections", async () => {
    const manager = createManager();
    const release = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<void>();
    const first = new Error("first rejection");
    manager.addPlugins([
      {
        name: "slow",
        async onError() {
          await release.promise;
          throw new Error("later rejection");
        },
      },
      {
        name: "fast",
        async onError() {
          failed.resolve();
          throw first;
        },
      },
    ]);
    const result = manager.runHookParallel("onError", event).catch((error) => error);
    await failed.promise;
    release.resolve();
    expect(await result).toBe(first);
  });

  it.each([null, undefined])("preserves a non-Error reporter failure: %s", async (failure) => {
    const manager = createManager();
    const later = vi.fn();
    manager.addPlugins([
      {
        name: "broken",
        onError() {
          throw failure;
        },
      },
      { name: "later", onError: later },
    ]);
    await expect(manager.runHookParallel("onError", event)).rejects.toBe(failure);
    expect(later).toHaveBeenCalledOnce();
  });

  it("retains filtered dispatch and enforce order when reporters succeed", async () => {
    const manager = createManager();
    const calls: string[] = [];
    manager.addPlugins([
      {
        name: "post",
        enforce: "post",
        onError() {
          calls.push("post");
        },
      },
      {
        name: "excluded",
        onError() {
          throw new Error("must not run");
        },
      },
      {
        name: "normal",
        onError() {
          calls.push("normal");
        },
      },
      {
        name: "pre",
        enforce: "pre",
        onError() {
          calls.push("pre");
        },
      },
    ]);
    await expect(
      manager.runHookParallelFiltered("onError", (plugin) => plugin.name !== "excluded", event),
    ).resolves.toBe(false);
    expect(calls).toEqual(["pre", "normal", "post"]);
    await expect(createManager().runHookParallel("onError", event)).resolves.toBe(false);
  });

  it.each([true, false])(
    "preserves a request failure and notifies all reporters in dev mode: %s",
    async (isDev) => {
      const manager = createManager(isDev);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const reported: unknown[] = [];
      manager.addPlugins([
        {
          name: "broken",
          onError() {
            throw new Error("reporting failed");
          },
        },
        {
          name: "observer",
          onError(payload) {
            reported.push(payload.error);
          },
        },
      ]);
      try {
        await expect(
          manager.runRuntimeRequest(new Request("http://localhost/failure"), () => {
            throw event.error;
          }),
        ).rejects.toBe(event.error);
        expect(reported).toEqual([event.error]);
      } finally {
        await manager.closeRuntime();
      }
    },
  );
});
