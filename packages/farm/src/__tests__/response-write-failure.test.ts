// @vitest-environment node
import { expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { sendWebResponse } from "../server/response";

it.each(["normal", "rejecting", "pending"])(
  "cancels a %s producer without masking or delaying the downstream write error",
  async (mode) => {
    const failure = new Error("downstream write failed");
    const cancel = vi.fn(() => {
      if (mode === "rejecting") return Promise.reject(new Error("cancel failed"));
      if (mode === "pending") return new Promise<void>(() => {});
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel,
    });
    const response = {
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      write() {
        throw failure;
      },
      end: vi.fn(),
      destroy: vi.fn(),
    };
    await expect(
      sendWebResponse(response as unknown as ServerResponse, new Response(stream)),
    ).rejects.toBe(failure);
    expect(response.destroy).toHaveBeenCalledWith(failure);
    expect(stream.locked).toBe(false);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(failure);
  },
);

it("cancels after a real Node strict Content-Length write error", async () => {
  const request = new IncomingMessage(new Socket());
  request.method = "GET";
  const response = new ServerResponse(request);
  response.strictContentLength = true;
  response.setHeader("content-length", "2");
  response.flushHeaders();
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel,
  });
  try {
    await expect(sendWebResponse(response, new Response(stream))).rejects.toMatchObject({
      code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][0]).toMatchObject({ code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" });
    expect(stream.locked).toBe(false);
  } finally {
    request.destroy();
    response.destroy();
    if (!stream.locked) void stream.cancel().catch(() => {});
  }
});
