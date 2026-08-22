import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createDeferredDataResponse,
  defer,
  DeferredDataError,
  isDeferred,
  prepareDeferredData,
  readDeferredDataResponse,
  reviveDeferredData,
  snapshotDeferredData,
  type Deferred,
} from "../deferred";

describe("deferred route data", () => {
  it("brands promises without changing their resolved type", async () => {
    const reviews = defer(Promise.resolve([{ id: 1 }]));

    expect(isDeferred(reviews)).toBe(true);
    expect(await reviews).toEqual([{ id: 1 }]);
    expectTypeOf(reviews).toEqualTypeOf<Deferred<Array<{ id: number }>>>();
  });

  it("prepares and revives settled deferred values for hydration", async () => {
    const reviews = defer(Promise.resolve(["clear", "typed"]));
    const prepared = prepareDeferredData({ product: { id: "p1" }, reviews });
    await reviews;
    await Promise.resolve();

    const revived = reviveDeferredData(prepared.data, snapshotDeferredData(prepared.records)) as {
      product: { id: string };
      reviews: Promise<string[]>;
    };

    expect(revived.product).toEqual({ id: "p1" });
    expect((revived.reviews as any).status).toBe("fulfilled");
    await expect(revived.reviews).resolves.toEqual(["clear", "typed"]);
  });

  it("preserves repeated deferred references in hydration values", async () => {
    const source = createControlledPromise<{ self: Deferred<unknown> }>();
    const value = defer(source.promise);
    const prepared = prepareDeferredData({ value });
    source.resolve({ self: value });
    await value;
    await Promise.resolve();

    const revived = reviveDeferredData(prepared.data, snapshotDeferredData(prepared.records)) as {
      value: Promise<{ self: Promise<unknown> }>;
    };
    const resolved = await revived.value;

    expect(resolved.self).toBe(revived.value);
  });

  it("round-trips user data shaped like the deferred marker", async () => {
    const payload = {
      meta: { $farmDeferred: "external-id" },
      alreadyEscaped: { $farmDeferred: "!keep-bang" },
      notAMarker: { $farmDeferred: "x", extra: 1 },
    };
    const prepared = prepareDeferredData(payload);

    const revived = reviveDeferredData(
      prepared.data,
      snapshotDeferredData(prepared.records),
    ) as typeof payload;

    expect(revived.meta).toEqual({ $farmDeferred: "external-id" });
    expect(revived.alreadyEscaped).toEqual({ $farmDeferred: "!keep-bang" });
    expect(revived.notAMarker).toEqual({ $farmDeferred: "x", extra: 1 });
    // None of these become promises.
    expect(typeof (revived.meta as any).then).toBe("undefined");
  });

  it("returns immediate data while deferred fields continue streaming", async () => {
    const source = createControlledPromise<string[]>();
    const response = createDeferredDataResponse({
      product: { id: "p1" },
      reviews: defer(source.promise),
    });

    const data = await readDeferredDataResponse<{
      product: { id: string };
      reviews: Promise<string[]>;
    }>(response);

    expect(data.product).toEqual({ id: "p1" });
    expect((data.reviews as any).status).toBe("pending");

    source.resolve(["fast", "streamed"]);
    await expect(data.reviews).resolves.toEqual(["fast", "streamed"]);
    expect((data.reviews as any).status).toBe("fulfilled");
  });

  it("streams nested deferred values discovered after the first result", async () => {
    const details = createControlledPromise<{ related: Deferred<string[]> }>();
    const related = createControlledPromise<string[]>();
    const response = createDeferredDataResponse({ details: defer(details.promise) });
    const data = await readDeferredDataResponse<{
      details: Promise<{ related: Promise<string[]> }>;
    }>(response);

    details.resolve({ related: defer(related.promise) });
    const resolvedDetails = await data.details;
    expect((resolvedDetails.related as any).status).toBe("pending");

    related.resolve(["p2", "p3"]);
    await expect(resolvedDetails.related).resolves.toEqual(["p2", "p3"]);
  });

  it("keeps rejected details private while reporting the server error", async () => {
    const onError = vi.fn();
    const source = createControlledPromise<string[]>();
    const response = createDeferredDataResponse(
      { reviews: defer(source.promise) },
      {},
      { onError },
    );
    const data = await readDeferredDataResponse<{ reviews: Promise<string[]> }>(response);

    source.reject(new Error("database password leaked"));

    await expect(data.reviews).rejects.toMatchObject({
      name: "DeferredDataError",
      code: "FARM_DEFERRED_DATA_ERROR",
      message: "Deferred route data failed to load",
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "d0");
    expect(String(await data.reviews.catch((error) => error))).not.toContain("password");
  });

  it("uses ordinary JSON when no values are deferred", async () => {
    const response = createDeferredDataResponse({ product: { id: "p1" } });

    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(readDeferredDataResponse(response)).resolves.toEqual({
      product: { id: "p1" },
    });
  });

  it("rejects circular route data before opening a stream", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() => createDeferredDataResponse(value)).toThrow(
      "Deferred route data must be JSON-serializable",
    );
  });

  it("uses a typed public error for malformed streams", async () => {
    const response = new Response("not-json\n", {
      headers: { "Content-Type": "application/x-farm-deferred+json" },
    });

    await expect(readDeferredDataResponse(response)).rejects.toBeInstanceOf(DeferredDataError);
  });
});

function createControlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
