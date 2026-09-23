import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { sendRscDevelopmentResponse } from "./dev-response.js";

describe("sendRscDevelopmentResponse", () => {
  it("waits for drain and cancels the stream after a disconnect", async () => {
    let notifyWrite!: () => void;
    const written = new Promise<void>((resolve) => {
      notifyWrite = resolve;
    });
    const cancel = vi.fn();
    let value = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([value++]));
      },
      cancel,
    });
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0,
      destroyed: false,
      writableEnded: false,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      write: vi.fn(() => {
        notifyWrite();
        return false;
      }),
      end: vi.fn(),
    });
    const sending = sendRscDevelopmentResponse(res as any, new Response(stream));
    await written;
    await setImmediate();
    expect(res.write).toHaveBeenCalledTimes(1);
    res.destroyed = true;
    res.emit("close");
    await sending;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(res.eventNames()).toEqual([]);
    expect(res.end).not.toHaveBeenCalled();
  });

  it("preserves repeated cookies and omits transfer encoding", async () => {
    const responseHeaders = new Headers();
    responseHeaders.append("set-cookie", "session=one; Path=/; HttpOnly");
    responseHeaders.append("set-cookie", "theme=dark; Path=/");
    responseHeaders.set("transfer-encoding", "chunked");

    const headers = new Map<string, string | string[]>();
    let body = Buffer.alloc(0);
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string | string[]) {
        headers.set(name.toLowerCase(), value);
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      write(chunk: Uint8Array) {
        body = Buffer.concat([body, Buffer.from(chunk)]);
        return true;
      },
      end(chunk?: Uint8Array) {
        if (chunk) body = Buffer.from(chunk);
      },
    };

    await sendRscDevelopmentResponse(
      res as any,
      new Response("hello", {
        status: 201,
        headers: responseHeaders,
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(headers.get("set-cookie")).toEqual([
      "session=one; Path=/; HttpOnly",
      "theme=dark; Path=/",
    ]);
    expect(headers.has("transfer-encoding")).toBe(false);
    expect(body.toString()).toBe("hello");
  });
});
