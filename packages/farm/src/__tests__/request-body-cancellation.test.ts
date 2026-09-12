// @vitest-environment node
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import { bufferFarmRequestBody, readFarmRequestBody } from "../server-http";

it.each([false, true])(
  "does not dispatch an upload aborted during a pending read (cloned: %s)",
  async (cloned) => {
    const abort = new AbortController();
    const reason = new Error("upload disconnected");
    let beganRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      beganRead = resolve;
    });
    let sent = false;
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new TextEncoder().encode("partial"));
          } else {
            beganRead();
          }
        },
      },
      { highWaterMark: 0 },
    );
    const original = new Request("https://farm.test/api/upload", {
      method: "POST",
      body: source,
      duplex: "half",
      signal: abort.signal,
    } as RequestInit);
    const request = cloned ? original.clone() : original;
    const endpoint = vi.fn(() => new Response("handler ran"));
    let failure: unknown;
    let completed = false;
    const handling = invokeAPIRouteEndpoint(endpoint, request)
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        completed = true;
      });
    try {
      await reading;
      abort.abort(reason);
      await vi.waitFor(() => expect(completed).toBe(true));
      expect(failure).toBe(reason);
      expect(endpoint).not.toHaveBeenCalled();
      expect(request.body!.locked).toBe(false);
    } finally {
      if (cloned) await original.body!.cancel();
      await handling;
    }
  },
);

it("rejects an already-aborted upload with its original reason", async () => {
  const reason = new Error("already disconnected");
  const request = new Request("https://farm.test/api/upload", {
    method: "POST",
    body: "partial",
    signal: AbortSignal.abort(reason),
  });
  const endpoint = vi.fn();
  await expect(invokeAPIRouteEndpoint(endpoint, request)).rejects.toBe(reason);
  expect(endpoint).not.toHaveBeenCalled();
});

it("does not mistake cancellation of an empty pending read for EOF", async () => {
  const abort = new AbortController();
  const request = new Request("https://farm.test/api/upload", {
    method: "POST",
    duplex: "half",
    signal: abort.signal,
    body: new ReadableStream<Uint8Array>(),
  } as RequestInit);
  const reading = readFarmRequestBody(request, 100);
  const assertion = expect(reading).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  await assertion;
  expect(request.body!.locked).toBe(false);
});

it("accepts normal EOF without treating an empty upload as aborted", async () => {
  const request = new Request("https://farm.test/api/upload", { method: "POST", body: "" });
  const endpoint = vi.fn(async (request: Request) => new Response(await request.text()));
  const response = await invokeAPIRouteEndpoint(endpoint, request);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
  expect(endpoint).toHaveBeenCalledOnce();
});

it.each([
  { length: "3", status: 413 },
  { length: undefined, status: 413 },
  { length: "invalid", status: 400 },
])(
  "rejects a cloned body without waiting for its original branch ($length)",
  async ({ length, status }) => {
    const request = new Request("http://farm.test/api/upload", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      }),
      duplex: "half",
      headers: length === undefined ? {} : { "content-length": length },
    } as RequestInit);
    const clone = request.clone();
    const cancel = vi.spyOn(ReadableStream.prototype, "cancel");
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    const endpoint = vi.fn(() => new Response("should not run"));
    let response: Response | undefined;
    const handling = invokeAPIRouteEndpoint(endpoint, clone, {}, 2).then((value) => {
      response = value;
    });
    try {
      await vi.waitFor(() =>
        expect(length === undefined ? cancelReader : cancel).toHaveBeenCalled(),
      );
      await setImmediate();
      expect(response?.status).toBe(status);
      expect(endpoint).not.toHaveBeenCalled();
      expect(clone.body!.locked).toBe(false);
    } finally {
      cancel.mockRestore();
      cancelReader.mockRestore();
      // Resolve the other native tee branch even when the regression assertion fails.
      await request.body!.cancel();
      await handling;
    }
  },
);

it.each(["declared", "counted"])(
  "preserves the body-limit error when %s cancellation rejects",
  async (mode) => {
    const request = new Request("http://farm.test/api/upload", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
          return Promise.reject(new Error("producer cleanup failed"));
        },
      }),
      duplex: "half",
      headers: mode === "declared" ? { "content-length": "3" } : {},
    } as RequestInit);
    const endpoint = vi.fn(() => new Response("should not run"));
    const response = await invokeAPIRouteEndpoint(endpoint, request, {}, 2);
    expect(response.status).toBe(413);
    expect(endpoint).not.toHaveBeenCalled();
    await setImmediate();
  },
);

it("still buffers an accepted clone and leaves the original readable", async () => {
  const request = new Request("http://farm.test/api/upload", { method: "POST", body: "ok" });
  const buffered = await bufferFarmRequestBody(request.clone(), 2);
  expect(await buffered.text()).toBe("ok");
  expect(await request.text()).toBe("ok");
});
