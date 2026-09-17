// @vitest-environment node
import { describe, expect, it } from "vitest";
import { definePlugin, PluginManager } from "../plugin";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createManager(plugins: unknown[]) {
  const manager = new PluginManager({ config: {}, isDev: true, isProd: false });
  for (const plugin of plugins) manager.addPlugin(plugin as never);
  return manager;
}

describe("plugin runtime start and shutdown ordering", () => {
  it("disposes a resource registered while shutdown is already requested", async () => {
    const gate = deferred();
    const disposed: string[] = [];

    // A plugin whose setup finishes only after shutdown has been requested,
    // which is what happens when a dev server is stopped during startup.
    const plugin = definePlugin({
      name: "slow-setup",
      async setup(context) {
        await gate.promise;
        context.lifecycle.onShutdown(() => {
          disposed.push("database");
        });
      },
    } as never);

    const manager = createManager([plugin]);

    const started = manager.startRuntime();
    const closed = manager.closeRuntime("dev-server-closed");

    // Let setup complete only after closeRuntime is in flight.
    gate.resolve();
    await started;
    await closed;

    // The resource must be disposed, not stranded.
    expect(disposed).toEqual(["database"]);
  });

  it("runs shutdown hooks only after startup finishes", async () => {
    const gate = deferred();
    const order: string[] = [];

    const plugin = definePlugin({
      name: "ordered",
      async setup() {
        await gate.promise;
        order.push("setup");
      },
      async shutdown() {
        order.push("shutdown");
      },
    } as never);

    const manager = createManager([plugin]);
    const started = manager.startRuntime();
    const closed = manager.closeRuntime("dev-server-closed");

    gate.resolve();
    await started;
    await closed;

    expect(order).toEqual(["setup", "shutdown"]);
  });

  it("still rejects cleanup registered once disposal is underway", async () => {
    let register: (() => void) | undefined;

    const plugin = definePlugin({
      name: "late-register",
      setup(context) {
        register = () => context.lifecycle.onShutdown(() => {});
      },
    } as never);

    const manager = createManager([plugin]);
    await manager.startRuntime();
    await manager.closeRuntime("done");

    expect(register).toBeTypeOf("function");
    expect(() => register!()).toThrow(/cannot be registered after shutdown begins/);
  });
});
