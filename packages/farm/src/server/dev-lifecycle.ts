import {
  createServer,
  resolveConfig,
  type InlineConfig,
  type Plugin,
  type ViteDevServer,
} from "vite";
import { FarmRuntimeShutdownError, type PluginManager } from "../plugin";
import type { FarmInstrumentationLifecycle } from "../instrumentation";
import { logger } from "../utils";

/**
 * Upper bound on waiting for Vite's own close. Vite 5.4 can strand its plugin
 * container's in-flight promises when closed after dependency discovery has
 * started (#1263); farm's shutdown must not inherit that hang.
 */
const VITE_CLOSE_TIMEOUT_MS = 10_000;

/** Capture the initial server before any app or renderer configureServer hook. */
export async function createViteDevServer(
  config: InlineConfig,
  capture: (server: ViteDevServer) => void,
): Promise<ViteDevServer> {
  const resolved = await resolveConfig(
    config,
    "serve",
    undefined,
    undefined,
    false,
    undefined,
    (plugins) => {
      // Vite places plugins from vite.config.* before inline plugins. Install the
      // capture after merging, before hook ordering is cached, to cover their pre
      // hooks too. It is not part of inlineConfig, so native restarts do not capture
      // a replacement candidate or change Farm's existing runtime ownership.
      plugins.unshift({
        name: "farm:dev-construction",
        configureServer: { order: "pre", handler: capture },
      });
    },
  );
  return createServer(resolved);
}

type VitePendingRequest = {
  request: Promise<unknown>;
};

async function drainVitePendingWork(server: ViteDevServer): Promise<void> {
  const environments = Object.values(server.environments ?? {});
  // Vite 8 can cancel an optimizer without awaiting its active Rolldown write.
  // Let discovery finish before collecting processing promises: the scan can
  // add dependencies that have no pending transform in the registry below.
  await Promise.allSettled(
    environments.map(async ({ depsOptimizer }) => {
      await depsOptimizer?.scanProcessing;
      await Promise.allSettled(
        Object.values(depsOptimizer?.metadata.discovered ?? {}).map((dep) => dep.processing),
      );
    }),
  );
  // Each Vite environment waits for this registry while it closes its plugin
  // container and dependency optimizer. That order can strand
  // optimized-dependency loads: the optimizer is gone, but the plugin hook
  // still awaits its processing promise. Drain every registry first while the
  // optimizers can finish; a request in one environment can start another.
  const registries = environments.map(
    (environment) =>
      (environment as { _pendingRequests?: Map<string, VitePendingRequest> })._pendingRequests,
  );
  const pending = () => registries.flatMap((registry) => (registry ? [...registry.values()] : []));

  for (let requests = pending(); requests.length > 0; requests = pending()) {
    await Promise.allSettled(requests.map(({ request }) => request));
  }
}

/** Close Vite even during partial construction, without stranding Farm's cleanup. */
export async function closeViteDevServer(
  server: ViteDevServer,
  closeViteServer: () => Promise<void>,
): Promise<void> {
  const closingHttpServer = server.httpServer;
  const closingWatcher = server.watcher;
  const closingWebSocket = server.ws;
  // Vite's close() can deadlock after the client entry has been transformed:
  // pending bare imports can wait for an optimizer that close cancels (#1263).
  // Drain first, but keep Farm's own teardown bounded if Vite cannot settle.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), VITE_CLOSE_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([
      (async () => {
        await drainVitePendingWork(server);
        await closeViteServer();
        return "closed" as const;
      })(),
      timedOut,
    ]);
    if (outcome === "timeout") {
      logger.error(
        `Vite server close did not settle within ${VITE_CLOSE_TIMEOUT_MS}ms; ` +
          "continuing shutdown without it (https://github.com/farming-labs/farm.js/issues/1263)",
      );
      // Best effort, all idempotent: stop serving even if a container is stranded.
      await Promise.allSettled([
        new Promise<void>((resolve) => {
          if (!closingHttpServer || !closingHttpServer.listening) return resolve();
          closingHttpServer.close(() => resolve());
        }),
        Promise.resolve(closingWatcher?.close?.()).catch(() => {}),
        Promise.resolve(closingWebSocket?.close?.()).catch(() => {}),
      ]);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One Farm runtime spans Vite's server generations. configureServer runs again
 * on native restart, so install the public close/restart wrappers each time.
 */
export function createFarmDevLifecyclePlugin(
  pluginManager: PluginManager,
  instrumentation: FarmInstrumentationLifecycle,
): Plugin {
  let runtimeServer: ViteDevServer | undefined;
  const pendingRestarts = new Set<Promise<void>>();
  // A failed restart may construct a candidate without adopting it. Resolve
  // the native closer by the live environment set, not the latest candidate.
  const viteClosers = new WeakMap<ViteDevServer["environments"], () => Promise<void>>();

  /**
   * Tear the whole dev runtime down once, collecting every failure.
   *
   * Plugin disposers own real resources — database pools, queue consumers —
   * so a caller awaiting close() has to be able to await them too, and a
   * failure has to surface instead of disappearing into an event listener.
   */
  let shutdownPromise: Promise<void> | undefined;
  const shutdownFarmDevRuntime = (server: ViteDevServer): Promise<void> => {
    shutdownPromise ??= (async () => {
      // A native restart replaces Vite's environments on this same server.
      // Finish that handoff before closing its current generation.
      await Promise.allSettled(pendingRestarts);
      const closeViteServer = viteClosers.get(server.environments)!;
      const failures: Array<{ label: string; error: unknown }> = [];
      const step = async (label: string, run: () => Promise<unknown> | undefined) => {
        try {
          await run();
        } catch (error) {
          failures.push({ label, error });
        }
      };

      // Finish Vite's active optimizer and transforms, stop serving, release
      // what the plugins hold, then flush telemetry last so shutdown problems
      // are still reported.
      await step("Vite server close", () => closeViteDevServer(server, closeViteServer));
      await step("Plugin runtime shutdown", () => pluginManager.closeRuntime("dev-server-closed"));
      await step("Instrumentation shutdown", () => instrumentation.shutdown());

      // A single failure propagates unchanged so existing callers keep the
      // error they already handle; several are aggregated with their stage.
      if (failures.length === 1) throw failures[0]!.error;
      if (failures.length > 1) {
        throw new FarmRuntimeShutdownError(
          `Dev server shutdown failed during ${failures.map(({ label }) => label).join(", ")}`,
          failures.map(({ error }) => error),
        );
      }
    })();
    return shutdownPromise;
  };

  return {
    name: "farm:dev-lifecycle",
    configureServer: {
      order: "post",
      handler(server) {
        // Capture app-provided close wrappers after configureServer hooks have
        // installed them, matching Farm's original outer shutdown ownership.
        return () => {
          // Vite keeps this public server identity across successful restarts.
          // A candidate that fails construction must not take runtime ownership.
          runtimeServer ??= server;
          const owner = runtimeServer;
          viteClosers.set(server.environments, server.close.bind(server));
          server.close = () => shutdownFarmDevRuntime(owner);

          const restartViteServer = server.restart.bind(server);
          server.restart = async (forceOptimize) => {
            if (shutdownPromise) {
              throw new Error("Cannot restart the Farm dev server during or after shutdown");
            }
            // Retain Vite's coalescing and forceOptimize behavior. The shared set
            // also covers calls made through a replacement generation's wrapper.
            const restart = restartViteServer(forceOptimize);
            pendingRestarts.add(restart);
            try {
              await restart;
            } finally {
              pendingRestarts.delete(restart);
            }
          };

          // After a restart, ignore retired/candidate HTTP listeners. A direct
          // HTTP close still owns final cleanup, even if a concurrent restart fails
          // and leaves the closed listener as the current generation.
          const httpServer = server.httpServer;
          httpServer?.once("close", () => {
            const closeIfCurrent = () => {
              if (owner.httpServer !== httpServer) return;
              shutdownFarmDevRuntime(owner).catch((error) => {
                logger.warn(`Dev server shutdown failed: ${error}`);
              });
            };
            if (pendingRestarts.size > 0) {
              void Promise.allSettled(pendingRestarts).then(closeIfCurrent);
            } else {
              closeIfCurrent();
            }
          });
        };
      },
    },
  };
}
