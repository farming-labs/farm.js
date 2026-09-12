// @vitest-environment node
import { expect, it, vi } from "vitest";
import { readJSONStream } from "../api/transport";

it("reports malformed NDJSON before an unread response clone finishes", async () => {
  const original = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("not json\n"));
      },
    }),
  );
  const response = original.clone();
  let failure: unknown;
  const iterator = readJSONStream(response)[Symbol.asyncIterator]();
  const reading = iterator.next().catch((error) => {
    failure = error;
  });
  try {
    await vi.waitFor(() => expect(failure).toBeInstanceOf(SyntaxError));
    expect(response.body!.locked).toBe(false);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  } finally {
    await original.body!.cancel();
    await reading;
  }
});

it("keeps the parse error when producer cancellation rejects", async () => {
  const cancel = vi.fn(() => Promise.reject(new Error("cleanup failed")));
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{broken}\n"));
      },
      cancel,
    }),
  );
  const stream = readJSONStream(response);
  await expect(stream[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(SyntaxError);
  expect(cancel).toHaveBeenCalledWith(expect.any(SyntaxError));
  expect(response.body!.locked).toBe(false);
  await stream.cancel();
});

it.each(["return", "cancel"] as const)(
  "still exposes producer cleanup completion from explicit %s",
  async (method) => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn(() => gate);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    const stream = readJSONStream(response);
    const iterator = stream[Symbol.asyncIterator]();
    let settled = false;
    const cancelling = (method === "return" ? iterator.return!() : stream.cancel("closed")).then(
      () => {
        settled = true;
      },
    );
    try {
      expect(cancel).toHaveBeenCalledOnce();
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally {
      finish();
      await cancelling;
    }
    expect(response.body!.locked).toBe(false);
  },
);

it("decodes split UTF-8 and a final line without a newline", async () => {
  const bytes = new TextEncoder().encode(' \n{"label":"café"}\n{"done":true}');
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  );
  const values = [];
  for await (const value of readJSONStream(response)) values.push(value);
  expect(values).toEqual([{ label: "café" }, { done: true }]);
  expect(response.body!.locked).toBe(false);
});

it("preserves a source read error and releases its reader", async () => {
  const failure = new Error("connection lost");
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    }),
  );
  await expect(readJSONStream(response)[Symbol.asyncIterator]().next()).rejects.toBe(failure);
  expect(response.body!.locked).toBe(false);
});
