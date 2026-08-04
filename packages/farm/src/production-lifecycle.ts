import type { ResolvedFarmServerConfig } from "./server-http";

export type FarmProductionLifecycleState = "starting" | "ready" | "draining" | "failed" | "closed";

export interface FarmProductionLifecycleOptions {
  server: ResolvedFarmServerConfig;
  start?: () => void | Promise<void>;
  close?: (reason: string) => void | Promise<void>;
}

export interface FarmResponseCompletionContext {
  onResponseFinished?: (callback: () => void) => void;
}

export interface FarmProductionLifecycle {
  readonly state: FarmProductionLifecycleState;
  readonly activeRequests: number;
  start(): Promise<void>;
  beginDrain(reason?: string): void;
  waitForIdle(timeoutMs?: number): Promise<boolean>;
  close(reason?: string): Promise<void>;
  handleHealthRequest(request: Request): Promise<Response | null>;
  runRequest(
    handler: () => Response | Promise<Response>,
    context?: FarmResponseCompletionContext,
  ): Promise<Response>;
}

export function createFarmProductionLifecycle(
  options: FarmProductionLifecycleOptions,
): FarmProductionLifecycle {
  let state: FarmProductionLifecycleState = "starting";
  let activeRequests = 0;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  const idleWaiters = new Set<() => void>();

  const notifyIdle = () => {
    if (activeRequests !== 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const start = async () => {
    if (state === "ready") return;
    if (startPromise) return startPromise;
    if (state === "draining" || state === "closed") {
      throw new Error("Farm production runtime is shutting down");
    }
    if (state === "failed") {
      throw new Error("Farm production runtime failed to start");
    }

    startPromise = Promise.resolve(options.start?.()).then(
      () => {
        if (state === "starting") state = "ready";
      },
      (error) => {
        state = "failed";
        throw error;
      },
    );
    return startPromise;
  };

  const beginDrain = (_reason = "production-server-draining") => {
    if (state === "closed" || state === "failed") return;
    state = "draining";
  };

  const waitForIdle = async (
    timeoutMs = options.server.gracefulShutdownTimeout,
  ): Promise<boolean> => {
    if (activeRequests === 0) return true;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (drained: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        idleWaiters.delete(onIdle);
        resolve(drained);
      };
      const onIdle = () => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      timeout.unref?.();
      idleWaiters.add(onIdle);
    });
  };

  const close = async (reason = "production-server-closed") => {
    if (closePromise) return closePromise;
    beginDrain(reason);
    closePromise = Promise.resolve(options.close?.(reason)).then(
      () => {
        state = "closed";
      },
      (error) => {
        state = "closed";
        throw error;
      },
    );
    return closePromise;
  };

  const handleHealthRequest = async (request: Request): Promise<Response | null> => {
    const health = options.server.health;
    if (!health.enabled) return null;

    const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    const isLiveness = pathname === health.livenessPath;
    const isReadiness = pathname === health.readinessPath;
    if (!isLiveness && !isReadiness) return null;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: createHealthHeaders({ allow: "GET, HEAD" }),
      });
    }

    if (isReadiness && state === "starting") {
      try {
        await start();
      } catch {
        // The readiness response below intentionally does not expose startup details.
      }
    }

    const healthy = isLiveness ? state !== "failed" && state !== "closed" : state === "ready";
    const body =
      request.method === "HEAD" ? null : JSON.stringify({ status: healthy ? "ok" : "unavailable" });
    return new Response(body, {
      status: healthy ? 200 : 503,
      headers: createHealthHeaders(healthy ? undefined : { retryAfter: "1" }),
    });
  };

  const runRequest = async (
    handler: () => Response | Promise<Response>,
    context: FarmResponseCompletionContext = {},
  ): Promise<Response> => {
    if (state === "draining" || state === "closed") return createDrainingResponse();
    await start();
    if (state !== "ready") return createDrainingResponse();

    activeRequests++;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      activeRequests--;
      notifyIdle();
    };

    try {
      const response = await handler();
      return trackResponseCompletion(response, finish, context.onResponseFinished);
    } catch (error) {
      finish();
      throw error;
    }
  };

  return {
    get state() {
      return state;
    },
    get activeRequests() {
      return activeRequests;
    },
    start,
    beginDrain,
    waitForIdle,
    close,
    handleHealthRequest,
    runRequest,
  };
}

function createHealthHeaders(options: { allow?: string; retryAfter?: string } = {}): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  if (options.allow) headers.set("allow", options.allow);
  if (options.retryAfter) headers.set("retry-after", options.retryAfter);
  return headers;
}

function createDrainingResponse(): Response {
  return new Response("Service Unavailable", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      connection: "close",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "1",
      "x-content-type-options": "nosniff",
    },
  });
}

function trackResponseCompletion(
  response: Response,
  finish: () => void,
  onResponseFinished?: (callback: () => void) => void,
): Response {
  if (onResponseFinished) {
    try {
      onResponseFinished(finish);
      return response;
    } catch {
      // Fall through to Web Stream tracking when an adapter rejects registration.
    }
  }

  if (!response.body) {
    finish();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
