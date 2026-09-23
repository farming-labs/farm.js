// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createFarmImageHandler } from "../image-server";
import { resolveFarmImageConfig } from "../image-config";

it.each([false, true])(
  "rejects an oversized cloned image without waiting for its sibling (declared: %s)",
  async (declared) => {
    const original = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(17));
        },
      }),
      { headers: declared ? { "content-length": "17" } : {} },
    );
    const source = original.clone();
    const transform = vi.fn();
    const handler = createFarmImageHandler(resolveFarmImageConfig({ maximumResponseBody: 16 }), {
      fetch: vi.fn(async () => source) as typeof fetch,
      transform,
    });
    let response: Response | null | undefined;
    const handling = handler(
      new Request("https://app.example.test/_farm/image?url=%2Flarge.png&w=640&q=75"),
    ).then((result) => {
      response = result;
    });
    try {
      await vi.waitFor(() => expect(response?.status).toBe(413));
      expect(source.body!.locked).toBe(false);
      expect(transform).not.toHaveBeenCalled();
    } finally {
      await original.body!.cancel();
      await handling;
    }
  },
);

it("releases an accepted source and preserves its bytes for transformation", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  const source = new Response(bytes, { headers: { "content-type": "image/png" } });
  const transform = vi.fn(async (input) => ({ body: input.source, contentType: input.sourceType }));
  const handler = createFarmImageHandler(resolveFarmImageConfig({ maximumResponseBody: 16 }), {
    fetch: vi.fn(async () => source) as typeof fetch,
    transform,
  });
  const response = await handler(
    new Request("https://app.example.test/_farm/image?url=%2Fsmall.png&w=640&q=75"),
  );
  expect(response?.status).toBe(200);
  expect(transform).toHaveBeenCalledWith(expect.objectContaining({ source: bytes }));
  expect(source.body!.locked).toBe(false);
});

it.each([
  ["declared", "pending"],
  ["declared", "rejecting"],
  ["counted", "pending"],
  ["counted", "rejecting"],
])("returns 413 for a %s size violation with %s cleanup", async (size, cleanup) => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cancel = vi.fn(() =>
    cleanup === "pending" ? gate : Promise.reject(new Error("cleanup failed")),
  );
  const source = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(17));
      },
      cancel,
    }),
    { headers: size === "declared" ? { "content-length": "17" } : {} },
  );
  const transform = vi.fn();
  const handler = createFarmImageHandler(resolveFarmImageConfig({ maximumResponseBody: 16 }), {
    fetch: vi.fn(async () => source) as typeof fetch,
    transform,
  });
  let response: Response | null | undefined;
  const handling = handler(
    new Request("https://app.example.test/_farm/image?url=%2Flarge.png&w=640&q=75"),
  ).then((result) => {
    response = result;
  });
  try {
    await vi.waitFor(() => expect(response?.status).toBe(413));
    expect(await response!.text()).toBe("Image is too large");
    expect(cancel).toHaveBeenCalledOnce();
    expect(transform).not.toHaveBeenCalled();
    expect(source.body!.locked).toBe(false);
  } finally {
    finish();
    await handling;
  }
});

it("unlocks an image source when reading fails", async () => {
  const source = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("source failed"));
      },
    }),
  );
  const transform = vi.fn();
  const handler = createFarmImageHandler(resolveFarmImageConfig(undefined), {
    fetch: vi.fn(async () => source) as typeof fetch,
    transform,
  });
  const response = await handler(
    new Request("https://app.example.test/_farm/image?url=%2Fphoto.png&w=640&q=75"),
  );
  expect(response?.status).toBe(500);
  expect(source.body!.locked).toBe(false);
  expect(transform).not.toHaveBeenCalled();
});
