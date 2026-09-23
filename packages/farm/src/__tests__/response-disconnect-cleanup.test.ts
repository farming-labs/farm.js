// @vitest-environment node
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { sendWebResponse } from "../server/response";

it.each(["destroyed", "close", "error"])(
  "releases the response without awaiting producer cleanup on %s",
  async (mode) => {
    let finishCancel!: () => void;
    let cancelStarted!: () => void;
    const cancelling = new Promise<void>((resolve) => {
      cancelStarted = resolve;
    });
    const cancelGate = new Promise<void>((resolve) => {
      finishCancel = resolve;
    });
    const cancel = vi.fn(() => {
      cancelStarted();
      return cancelGate;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const response = Object.assign(new EventEmitter(), {
      destroyed: mode === "destroyed",
      writableEnded: false,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      end: vi.fn(),
      write: vi.fn(() => false),
    });
    let settled = false;
    const sending = sendWebResponse(
      response as unknown as ServerResponse,
      new Response(stream),
    ).then(() => {
      settled = true;
    });
    try {
      if (mode !== "destroyed") {
        await vi.waitFor(() => expect(response.listenerCount("drain")).toBe(1));
        response.emit(mode);
      }
      await cancelling;
      await setImmediate();
      expect(settled).toBe(true);
      expect(stream.locked).toBe(false);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(response.eventNames()).toEqual([]);
      expect(response.end).not.toHaveBeenCalled();
    } finally {
      finishCancel();
      await sending;
    }
  },
);

it("handles rejecting producer cleanup without an unhandled rejection", async () => {
  const stream = new ReadableStream({
    cancel() {
      return Promise.reject(new Error("cleanup failed"));
    },
  });
  const response = Object.assign(new EventEmitter(), {
    destroyed: true,
    writableEnded: false,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  });
  await sendWebResponse(response as unknown as ServerResponse, new Response(stream));
  await setImmediate();
  expect(stream.locked).toBe(false);
  expect(response.eventNames()).toEqual([]);
});
