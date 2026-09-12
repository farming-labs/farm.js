// @vitest-environment node
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { prepareServerActionRequest } from "../server-action-security";

function actionRequest(body: ReadableStream<Uint8Array>) {
  return new Request("https://farm.test/action", {
    method: "POST",
    headers: { origin: "https://farm.test", "content-type": "text/plain" },
    body,
    duplex: "half",
  } as RequestInit);
}

it("rejects a streamed oversized action without waiting for the original tee branch", async () => {
  const request = actionRequest(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    }),
  );
  const clone = request.clone();
  const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
  let failure: unknown;
  const reading = prepareServerActionRequest(
    clone,
    { allowedOrigins: [], bodySizeLimit: 2 },
    "javascript",
    "action-id",
  ).catch((error) => {
    failure = error;
  });
  try {
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    await setImmediate();
    expect(failure).toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
    expect(clone.body!.locked).toBe(false);
  } finally {
    cancel.mockRestore();
    await request.body!.cancel();
    await reading;
  }
});

it("keeps the action size error when producer cancellation rejects", async () => {
  const request = actionRequest(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        return Promise.reject(new Error("cleanup failed"));
      },
    }),
  );
  await expect(
    prepareServerActionRequest(
      request,
      { allowedOrigins: [], bodySizeLimit: 2 },
      "javascript",
      "action-id",
    ),
  ).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  await setImmediate();
});
