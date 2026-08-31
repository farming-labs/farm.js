import { describe, expect, it } from "vitest";
import { sendWebResponse } from "../server/response";

describe("sendWebResponse", () => {
  it("streams bodies to Node-compatible response adapters without EventEmitter internals", async () => {
    const chunks: Buffer[] = [];
    const headers = new Map<string, string | string[]>();
    const res = {
      statusCode: 200,
      writableEnded: false,
      setHeader: (key: string, value: string | string[]) => {
        headers.set(key, value);
      },
      write: (chunk: Uint8Array) => {
        chunks.push(Buffer.from(chunk));
        return true;
      },
      end: () => {
        res.writableEnded = true;
      },
      destroy: (error: Error) => {
        throw error;
      },
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("hello "));
        controller.enqueue(encoder.encode("stream"));
        controller.close();
      },
    });

    await sendWebResponse(
      res as any,
      new Response(stream, {
        status: 201,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(headers.get("content-type")).toBe("text/plain");
    expect(res.writableEnded).toBe(true);
    expect(Buffer.concat(chunks).toString()).toBe("hello stream");
  });
});
