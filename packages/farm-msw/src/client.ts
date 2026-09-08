"use client";

import { setupWorker } from "msw/browser";
import { handlers } from "virtual:farm-msw-handlers";
import type { MswUnhandledRequestBehavior } from "./config.js";

export interface MswBrowserRuntimeOptions {
  workerUrl: string;
  scope: string;
  onUnhandledRequest: MswUnhandledRequestBehavior;
}

export interface FarmMswBrowserRuntime {
  stop(): void;
}

/** Start the browser worker used by the Farm plugin during development. */
export async function startMswBrowserRuntime(
  options: MswBrowserRuntimeOptions,
): Promise<FarmMswBrowserRuntime> {
  const worker = setupWorker(...handlers);
  await worker.start({
    onUnhandledRequest: options.onUnhandledRequest,
    serviceWorker: {
      url: options.workerUrl,
      options: { scope: options.scope },
    },
  });

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      worker.stop();
    },
  };
}
