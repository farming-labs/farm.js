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

describe("plugin runtime shutdown during startup", () => {
  it("disposes a resource registered while shutdown is already running", async () => {
    const gate = deferred();
    const disposed: string[] = [];

    // Setup finishes only after shutdown has begun, which is what happens when
    // a dev server or a SIGTERM stops the process mid-startup.
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

    gate.resolve();
    await started;
    await closed;

    // The late resource must still be released, not stranded.
    expect(disposed).toEqual(["database"]);
  });

  it("does not wait for a startup that never finishes", async () => {
    const disposed: string[] = [];

    // A runtime.start() that never resolves must not block shutdown; the
    // production runtime relies on this to honour SIGTERM during startup.
    const plugin = definePlugin({
      name: "hanging-start",
      setup(context) {
        context.lifecycle.onShutdown(() => {
          disposed.push("resource");
        });
      },
      runtime: {
        start() {
          return new Promise<void>(() => {});
        },
        close() {},
      },
    } as never);

    const manager = createManager([plugin]);
    void manager.startRuntime();

    // Would hang forever if shutdown awaited startup.
    await manager.closeRuntime("sigterm");

    expect(disposed).toEqual(["resource"]);
  });

  it("disposes a resource registered from inside a shutdown hook", async () => {
    const disposed: string[] = [];

    const plugin = definePlugin({
      name: "registers-during-shutdown",
      setup(context) {
        context.lifecycle.onShutdown(() => {
          disposed.push("first");
          // A disposer that opens one more cleanup while draining.
          context.lifecycle.onShutdown(() => {
            disposed.push("second");
          });
        });
      },
    } as never);

    const manager = createManager([plugin]);
    await manager.startRuntime();
    await manager.closeRuntime("done");

    expect(disposed).toEqual(["first", "second"]);
  });

  it("releases cleanup registered after shutdown has finished", async () => {
    const disposed: string[] = [];
    let register: (() => void) | undefined;

    const plugin = definePlugin({
      name: "late-register",
      setup(context) {
        register = () =>
          context.lifecycle.onShutdown(() => {
            disposed.push("late");
          });
      },
    } as never);

    const manager = createManager([plugin]);
    await manager.startRuntime();
    await manager.closeRuntime("done");

    expect(register).toBeTypeOf("function");
    // Registering once the runtime is closed must not throw into plugin setup,
    // and must not strand the resource either.
    expect(() => register!()).not.toThrow();
    await Promise.resolve();
    expect(disposed).toEqual(["late"]);
  });
});
