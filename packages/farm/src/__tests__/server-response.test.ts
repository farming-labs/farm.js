import { describe, expect, it } from "vitest";
import { sendWebResponse } from "../server/response";

describe("sendWebResponse", () => {
  it("keeps comma-joined fallback cookies separate without splitting Expires", async () => {
    const headers = new Map<string, string | string[]>();
    const res = {
      statusCode: 200,
      writableEnded: false,
      getHeader: (key: string) => headers.get(key),
      setHeader: (key: string, value: string | string[]) => {
        headers.set(key, value);
      },
      end: () => {
        res.writableEnded = true;
      },
    };
    const response = {
      status: 204,
      body: null,
      headers: {
        forEach(callback: (value: string, key: string) => void) {
          callback(
            "session=abc; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/, theme=dark; Path=/",
            "set-cookie",
          );
        },
      },
    };

    await sendWebResponse(res as any, response as Response);

    expect(headers.get("Set-Cookie")).toEqual([
      "session=abc; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/",
      "theme=dark; Path=/",
    ]);
  });

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
