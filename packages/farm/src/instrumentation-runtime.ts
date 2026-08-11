export type FarmInstrumentationRuntime = "nodejs" | "edge" | "bun";
export type FarmInstrumentationMode = "development" | "production" | "test";

export interface FarmInstrumentationContext {
  root: string;
  mode: FarmInstrumentationMode;
  runtime: FarmInstrumentationRuntime;
}

export type FarmInstrumentationCleanup =
  | void
  | (() => void | Promise<void>)
  | { shutdown: () => void | Promise<void> };

export interface FarmInstrumentationModule {
  register?: (
    context: FarmInstrumentationContext,
  ) => FarmInstrumentationCleanup | Promise<FarmInstrumentationCleanup>;
  shutdown?: () => void | Promise<void>;
}

export interface FarmInstrumentationLifecycle {
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createFarmInstrumentationLifecycle(
  module: FarmInstrumentationModule | null | undefined,
  context: FarmInstrumentationContext,
): FarmInstrumentationLifecycle {
  let startPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let cleanup: Exclude<FarmInstrumentationCleanup, void> | undefined;

  return {
    start() {
      if (!startPromise) {
        startPromise = Promise.resolve(module?.register?.(context)).then((result) => {
          cleanup = result || undefined;
        });
      }
      return startPromise;
    },
    shutdown() {
      if (!shutdownPromise) {
        shutdownPromise = (async () => {
          try {
            await startPromise;
          } catch {
            // A partially initialized module may still need its exported cleanup.
          }
          try {
            if (typeof cleanup === "function") {
              await cleanup();
            } else if (cleanup?.shutdown) {
              await cleanup.shutdown();
            }
          } finally {
            if (module?.shutdown) {
              await module.shutdown();
            }
          }
        })();
      }
      return shutdownPromise;
    },
  };
}

export function resolveFarmInstrumentationRuntime(preset?: string): FarmInstrumentationRuntime {
  const normalized = preset?.toLowerCase() ?? "";
  if (
    normalized.includes("cloudflare") ||
    normalized.includes("worker") ||
    normalized.includes("edge")
  ) {
    return "edge";
  }
  if (normalized.includes("bun")) return "bun";
  return "nodejs";
}
