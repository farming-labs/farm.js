// @vitest-environment node
import { expect, it, vi } from "vitest";
import { readJSONStream } from "../api/transport";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

it("serves concurrent next calls from one buffered chunk without waiting for another", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
  );
  const stream = readJSONStream<number>(response);
  const iterator = stream[Symbol.asyncIterator]();
  const values: IteratorResult<number>[] = [];
  const reads = Promise.all(
    [iterator.next(), iterator.next()].map(async (next) => {
      const value = await next;
      values.push(value);
      return value;
    }),
  );
  controller.enqueue(new TextEncoder().encode("1\n2\n"));
  try {
    await vi.waitFor(() =>
      expect(values).toEqual([
        { done: false, value: 1 },
        { done: false, value: 2 },
      ]),
    );
  } finally {
    controller.close();
    await reads;
    await stream.cancel();
  }
});

it("keeps order through split UTF-8, blank lines, final unterminated lines and EOF", async () => {
  const bytes = new TextEncoder().encode('"café"\n\n2\n{"ok":true}\nfalse');
  let offset = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
        else controller.close();
      },
    }),
  );
  const iterator = readJSONStream(response)[Symbol.asyncIterator]();
  await expect(Promise.all(Array.from({ length: 6 }, () => iterator.next()))).resolves.toEqual([
    { done: false, value: "café" },
    { done: false, value: 2 },
    { done: false, value: { ok: true } },
    { done: false, value: false },
    { done: true, value: undefined },
    { done: true, value: undefined },
  ]);
  expect(response.body!.locked).toBe(false);
});

it.each(["return", "cancel"] as const)(
  "%s interrupts active and queued reads without waiting for cleanup",
  async (method) => {
    const started = deferred<void>();
    const cleanup = deferred<void>();
    const cancel = vi.fn(() => cleanup.promise);
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            started.resolve();
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
    const stream = readJSONStream(response);
    const iterator = stream[Symbol.asyncIterator]();
    const reads = Promise.all([iterator.next(), iterator.next()]);
    await started.promise;
    let cleaned = false;
    const cancelling = (method === "return" ? iterator.return!() : stream.cancel("closed")).then(
      () => {
        cleaned = true;
      },
    );
    try {
      await expect(reads).resolves.toEqual([
        { done: true, value: undefined },
        { done: true, value: undefined },
      ]);
      expect(cancel).toHaveBeenCalledOnce();
      expect(cleaned).toBe(false);
    } finally {
      cleanup.resolve();
      await cancelling;
    }
    expect(response.body!.locked).toBe(false);
  },
);

it("does not consume a ready chunk after cancellation before a queued read resumes", async () => {
  const response = new Response(new TextEncoder().encode("1\n2\n"));
  const stream = readJSONStream(response);
  const iterator = stream[Symbol.asyncIterator]();
  const reading = iterator.next();
  await stream.cancel();
  await expect(reading).resolves.toEqual({ done: true, value: undefined });
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
});

it.each(["parse", "source"] as const)(
  "does not poison queued reads after a %s error",
  async (kind) => {
    const failure = new Error("source failed");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (kind === "parse") controller.enqueue(new TextEncoder().encode("{bad}\n"));
          else controller.error(failure);
        },
      }),
    );
    const iterator = readJSONStream(response)[Symbol.asyncIterator]();
    const first = iterator.next().catch((error) => error);
    const second = iterator.next();
    if (kind === "parse") expect(await first).toBeInstanceOf(SyntaxError);
    else expect(await first).toBe(failure);
    await expect(second).resolves.toEqual({ done: true, value: undefined });
    expect(response.body!.locked).toBe(false);
  },
);

it("exposes explicit cleanup errors but still finishes queued reads", async () => {
  const failure = new Error("cleanup failed");
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        throw failure;
      },
    }),
  );
  const stream = readJSONStream(response);
  const iterator = stream[Symbol.asyncIterator]();
  const reads = Promise.all([iterator.next(), iterator.next()]);
  await expect(stream.cancel()).rejects.toBe(failure);
  await expect(reads).resolves.toEqual([
    { done: true, value: undefined },
    { done: true, value: undefined },
  ]);
  expect(response.body!.locked).toBe(false);
});
