// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter, once } from "node:events";
import { createServer, request, type ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { after, _runWithAfterNodeResponse } from "../after";

afterEach(() => vi.useRealTimers());

async function closedResponse(mode: "finished" | "destroyed"): Promise<ServerResponse> {
  let resolveResponse!: (response: ServerResponse) => void;
  const responseClosed = new Promise<ServerResponse>((resolve) => {
    resolveResponse = resolve;
  });
  const server = createServer((_request, response) => {
    response.once("close", () => resolveResponse(response));
    if (mode === "finished") response.end("ok");
    else response.destroy();
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const client = request({ host: "127.0.0.1", port: address.port });
    const clientClosed = new Promise<void>((resolve) => client.once("close", resolve));
    const result = new Promise<number | string | undefined>((resolve) => {
      client.on("response", (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      client.on("error", (error: NodeJS.ErrnoException) => resolve(error.code));
    });
    client.end();
    const response = await responseClosed;
    expect(await result).toBe(mode === "finished" ? 200 : "ECONNRESET");
    await clientClosed;
    return response;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

it.each(["finished", "destroyed"] as const)(
  "settles after() and removes only Farm listeners on an already %s Node response",
  async (mode) => {
    // Real HTTP events have already fired before Farm takes ownership. Neither
    // finish nor close will fire again to rescue a missed completion boundary.
    const response = await closedResponse(mode);
    expect(response.destroyed).toBe(true);
    expect(response.writableEnded).toBe(mode === "finished");
    const external = () => {};
    response.on("finish", external);
    response.on("close", external);
    const originalFinish = response.listeners("finish");
    const originalClose = response.listeners("close");
    const scope = new AsyncLocalStorage<string>();
    const events: string[] = [];
    let lifetime!: Promise<void>;
    vi.useFakeTimers();
    try {
      const value = await _runWithAfterNodeResponse(
        response,
        () =>
          scope.run("request-context", () => {
            after(() => {
              events.push(scope.getStore()!);
              after(() => {
                events.push("nested");
              });
            });
            after(() => {
              events.push("second");
            });
            return "handler-result";
          }),
        {
          waitUntil(promise) {
            lifetime = promise;
          },
        },
      );
      expect(value).toBe("handler-result");
      expect(events).toEqual([]);
      await vi.runAllTimersAsync();
      expect(events).toEqual(["request-context", "second", "nested"]);
      await lifetime;
      expect(response.listeners("finish")).toEqual(originalFinish);
      expect(response.listeners("close")).toEqual(originalClose);
    } finally {
      // Also settle the old broken implementation when asserting the regression.
      response.emit("close");
      await lifetime;
      response.off("finish", external);
      response.off("close", external);
    }
  },
);

it.each(["finish", "close"] as const)(
  "waits for %s on a live response and ignores later completion events",
  async (event) => {
    vi.useFakeTimers();
    const response = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
    const callback = vi.fn();
    let lifetime!: Promise<void>;
    await _runWithAfterNodeResponse(response as ServerResponse, () => after(callback), {
      waitUntil(promise) {
        lifetime = promise;
      },
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(callback).not.toHaveBeenCalled();
    response.emit(event);
    await lifetime;
    response.emit("finish");
    response.emit("close");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(response.listenerCount("finish")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  },
);

it.each(["finish", "close"] as const)(
  "settles once when %s races the already-ended response timer",
  async (event) => {
    vi.useFakeTimers();
    const response = Object.assign(new EventEmitter(), { writableEnded: true, destroyed: false });
    const callback = vi.fn();
    let lifetime!: Promise<void>;
    await _runWithAfterNodeResponse(response as ServerResponse, () => after(callback), {
      waitUntil(promise) {
        lifetime = promise;
      },
    });
    response.emit(event);
    await vi.runAllTimersAsync();
    await lifetime;
    expect(callback).toHaveBeenCalledTimes(1);
    expect(response.listenerCount("finish")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  },
);

it("preserves a handler rejection while completing an already-destroyed response", async () => {
  vi.useFakeTimers();
  const response = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: true });
  const callback = vi.fn();
  const failure = new Error("handler failed");
  let lifetime!: Promise<void>;
  try {
    await expect(
      _runWithAfterNodeResponse(
        response as ServerResponse,
        () => {
          after(callback);
          throw failure;
        },
        {
          waitUntil(promise) {
            lifetime = promise;
          },
        },
      ),
    ).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    expect(callback).toHaveBeenCalledTimes(1);
    await lifetime;
    expect(response.listenerCount("finish")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  } finally {
    response.emit("close");
    await lifetime;
  }
});
