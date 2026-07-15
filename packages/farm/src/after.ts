import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerResponse } from "node:http";

export type AfterCallback = () => void | Promise<void>;

/** Runtime hooks supplied by a deployment adapter. */
export interface FarmAfterPlatformContext {
  /** Keep a serverless invocation alive until the scheduled work settles. */
  waitUntil?: (promise: Promise<void>) => void;
  /** Register a callback that runs once the response has finished. */
  onResponseFinished?: (callback: () => void) => void;
}

interface AfterTask {
  result: Promise<void>;
  start: () => void;
}

interface AfterRequestState {
  completion: Promise<void>;
  finishResponse: () => void;
  phase: "open" | "running" | "closed";
  reportError: (error: unknown) => void;
  tasks: AfterTask[];
}

const AFTER_STORAGE = Symbol.for("@farmjs/core/after-storage");

function getAfterStorage(): AsyncLocalStorage<AfterRequestState> {
  const runtime = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = runtime[AFTER_STORAGE];
  if (existing instanceof AsyncLocalStorage) {
    return existing as AsyncLocalStorage<AfterRequestState>;
  }

  const storage = new AsyncLocalStorage<AfterRequestState>();
  runtime[AFTER_STORAGE] = storage;
  return storage;
}

const afterStorage = getAfterStorage();

function defaultAfterErrorReporter(error: unknown): void {
  console.error("[Farm.js] after() callback failed:", error);
}

function createAfterRequestState(
  reportError: (error: unknown) => void = defaultAfterErrorReporter,
): AfterRequestState {
  let resolveResponseFinished!: () => void;
  let responseFinished = false;
  const responseFinishedPromise = new Promise<void>((resolve) => {
    resolveResponseFinished = resolve;
  });

  const state: AfterRequestState = {
    completion: Promise.resolve(),
    finishResponse: () => {
      if (responseFinished) return;
      responseFinished = true;
      resolveResponseFinished();
    },
    phase: "open",
    reportError,
    tasks: [],
  };

  state.completion = responseFinishedPromise.then(() =>
    afterStorage.run(state, async () => {
      state.phase = "running";

      for (let index = 0; index < state.tasks.length; index++) {
        const task = state.tasks[index];
        task.start();
        try {
          await task.result;
        } catch (error) {
          state.reportError(error);
        }
      }

      state.phase = "closed";
    }),
  );

  return state;
}

function registerPlatformLifetime(
  state: AfterRequestState,
  context: FarmAfterPlatformContext | undefined,
): void {
  if (!context?.waitUntil) return;

  try {
    context.waitUntil(state.completion);
  } catch (error) {
    state.reportError(error);
  }
}

function registerResponseFinishedHook(
  state: AfterRequestState,
  context: FarmAfterPlatformContext | undefined,
): boolean {
  if (!context?.onResponseFinished) return false;

  try {
    context.onResponseFinished(state.finishResponse);
    return true;
  } catch (error) {
    state.reportError(error);
    return false;
  }
}

function finishSoon(state: AfterRequestState): void {
  queueMicrotask(state.finishResponse);
}

function wrapResponseBody(
  response: Response,
  request: Request,
  state: AfterRequestState,
): Response {
  if (request.method === "HEAD" || !response.body || response.bodyUsed || response.body.locked) {
    finishSoon(state);
    return response;
  }

  const reader = response.body.getReader();
  let released = false;
  const releaseReader = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          releaseReader();
          controller.close();
          finishSoon(state);
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        releaseReader();
        controller.error(error);
        finishSoon(state);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        releaseReader();
        finishSoon(state);
      }
    },
  });

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Schedule non-blocking work for after the current response finishes.
 *
 * Callbacks run in registration order. A callback failure is reported without
 * changing the response or preventing later callbacks from running.
 */
export function after(callback: AfterCallback): void {
  if (typeof callback !== "function") {
    throw new TypeError("after() expects a callback function.");
  }

  const state = afterStorage.getStore();
  if (!state) {
    throw new Error("after() can only be used while Farm is handling a server request.");
  }
  if (state.phase === "closed") {
    throw new Error("after() cannot schedule work after the request lifecycle has completed.");
  }

  let start!: () => void;
  const ready = new Promise<void>((resolve) => {
    start = resolve;
  });

  // Registering the continuation here preserves every request AsyncLocalStorage
  // context that is active at the after() call site.
  const result = ready.then(callback);
  state.tasks.push({ result, start });
}

/** @internal Run a Web Request handler inside Farm's post-response lifecycle. */
export async function _runWithAfterRequest(
  request: Request,
  handler: () => Response | Promise<Response>,
  context?: FarmAfterPlatformContext,
): Promise<Response> {
  if (afterStorage.getStore()) {
    return await handler();
  }

  const state = createAfterRequestState();
  registerPlatformLifetime(state, context);
  const hasResponseHook = registerResponseFinishedHook(state, context);

  try {
    const response = await afterStorage.run(state, handler);
    return hasResponseHook ? response : wrapResponseBody(response, request, state);
  } catch (error) {
    if (!hasResponseHook) finishSoon(state);
    throw error;
  }
}

/** @internal Run a Node response handler inside Farm's post-response lifecycle. */
export async function _runWithAfterNodeResponse<T>(
  response: ServerResponse,
  handler: () => T | Promise<T>,
  context?: Pick<FarmAfterPlatformContext, "waitUntil">,
): Promise<T> {
  if (afterStorage.getStore()) {
    return await handler();
  }

  const state = createAfterRequestState();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    response.off("finish", finish);
    response.off("close", finish);
    state.finishResponse();
  };

  response.once("finish", finish);
  response.once("close", finish);
  if (response.writableEnded) finishSoon(state);
  registerPlatformLifetime(state, context);

  return await afterStorage.run(state, handler);
}
