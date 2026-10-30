import type { ConvexRuntime, ConvexRuntimeHolder } from "./types.js";

const runtimeHolder = globalThis as ConvexRuntimeHolder;

export function setConvexRuntime(runtime: ConvexRuntime): void {
  runtimeHolder.__farmConvexRuntime = runtime;
}

export function readConvexRuntime(): ConvexRuntime | undefined {
  return runtimeHolder.__farmConvexRuntime;
}

export function requireConvexRuntime(): ConvexRuntime {
  const runtime = readConvexRuntime();
  if (!runtime) {
    throw new Error(
      "@farm.js/convex/server needs convex() in the farm.config.ts integrations with CONVEX_URL set. On a new app, let farm dev create the deployment, then restart it.",
    );
  }
  return runtime;
}
