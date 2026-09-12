// @vitest-environment node
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import { bufferFarmRequestBody } from "../server-http";

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
