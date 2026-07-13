export const FARM_DEFERRED_CONTENT_TYPE = "application/x-farm-deferred+json";
export const FARM_DEFERRED_ERROR_CODE = "FARM_DEFERRED_DATA_ERROR";
export const FARM_DEFERRED_BRAND: unique symbol = Symbol.for(
  "farm.deferred",
) as typeof FARM_DEFERRED_BRAND;

const FARM_DEFERRED_MARKER = "$farmDeferred";

type DeferredState<T = unknown> =
  | { status: "pending" }
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export interface Deferred<T> extends Promise<T> {
  readonly [FARM_DEFERRED_BRAND]: true;
}

export interface PreparedDeferredData {
  data: unknown;
  records: readonly DeferredRecord[];
}

export interface DeferredRecord {
  id: string;
  promise: Deferred<unknown>;
}

export type DeferredSettlement =
  | { status: "fulfilled"; value: unknown }
  | { status: "rejected"; error: { code: typeof FARM_DEFERRED_ERROR_CODE; message: string } };

export type DeferredSettlements = Record<string, DeferredSettlement>;

export interface DeferredDataResponseOptions {
  onError?: (error: unknown, id: string) => void;
}

export class DeferredDataError extends Error {
  readonly name = "DeferredDataError";
  readonly code = FARM_DEFERRED_ERROR_CODE;

  constructor(message = "Deferred route data failed to load") {
    super(message);
  }
}

const deferredStates = new WeakMap<object, DeferredState>();

export function defer<T>(value: PromiseLike<T>): Deferred<Awaited<T>> {
  if (isDeferred(value)) {
    return value as Deferred<Awaited<T>>;
  }

  const promise = Promise.resolve(value) as Deferred<Awaited<T>>;
  Object.defineProperty(promise, FARM_DEFERRED_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  deferredStates.set(promise, { status: "pending" });
  promise.then(
    (resolved) => deferredStates.set(promise, { status: "fulfilled", value: resolved }),
    (reason) => deferredStates.set(promise, { status: "rejected", reason }),
  );
  return promise;
}

export function isDeferred<T = unknown>(value: unknown): value is Deferred<T> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    (value as Record<PropertyKey, unknown>)[FARM_DEFERRED_BRAND] === true,
  );
}

export function prepareDeferredData(value: unknown): PreparedDeferredData {
  const context = createEncodingContext();
  return {
    data: encodeDeferredValue(value, context, new WeakSet()),
    records: context.records,
  };
}

export function snapshotDeferredData(records: readonly DeferredRecord[]): DeferredSettlements {
  const context = createEncodingContext(records);
  const settlements: DeferredSettlements = {};

  for (let index = 0; index < context.records.length; index++) {
    const record = context.records[index]!;
    const state = readDeferredState(record.promise);

    if (state.status === "fulfilled") {
      try {
        settlements[record.id] = {
          status: "fulfilled",
          value: encodeDeferredValue(state.value, context, new WeakSet()),
        };
      } catch {
        settlements[record.id] = createRejectedSettlement();
      }
    } else {
      settlements[record.id] = createRejectedSettlement();
    }
  }

  return settlements;
}

export function reviveDeferredData<T>(value: T, settlements: DeferredSettlements): T {
  return reviveDeferredValue(value, new Map(), settlements) as T;
}

export function createDeferredDataResponse(
  value: unknown,
  init: ResponseInit = {},
  options: DeferredDataResponseOptions = {},
): Response {
  const context = createEncodingContext();
  const data = encodeDeferredValue(value, context, new WeakSet());
  const headers = new Headers(init.headers);

  if (context.records.length === 0) {
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(data), { ...init, headers });
  }

  headers.set("Content-Type", `${FARM_DEFERRED_CONTENT_TYPE}; charset=utf-8`);
  headers.set("Cache-Control", headers.get("Cache-Control") || "private, max-age=0");
  const initialLine = encodeDeferredMessage({ type: "data", data });
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(initialLine));
      let pending = context.records.length;

      const finishRecord = () => {
        pending--;
        if (!cancelled && pending === 0) controller.close();
      };

      const schedule = (record: DeferredRecord) => {
        record.promise
          .then(
            (resolved) => {
              if (cancelled) return;
              try {
                const previousLength = context.records.length;
                const encoded = encodeDeferredValue(resolved, context, new WeakSet());
                const nestedRecords = context.records.slice(previousLength);
                pending += nestedRecords.length;
                controller.enqueue(
                  encoder.encode(
                    encodeDeferredMessage({ type: "resolve", id: record.id, data: encoded }),
                  ),
                );
                for (const nestedRecord of nestedRecords) schedule(nestedRecord);
              } catch (error) {
                reportDeferredError(options, error, record.id);
                controller.enqueue(
                  encoder.encode(
                    encodeDeferredMessage({
                      type: "reject",
                      id: record.id,
                      error: createDeferredPublicError(),
                    }),
                  ),
                );
              }
            },
            (error) => {
              if (cancelled) return;
              reportDeferredError(options, error, record.id);
              controller.enqueue(
                encoder.encode(
                  encodeDeferredMessage({
                    type: "reject",
                    id: record.id,
                    error: createDeferredPublicError(),
                  }),
                ),
              );
            },
          )
          .finally(finishRecord);
      };

      const initialRecords = context.records.slice();
      for (const record of initialRecords) schedule(record);
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, { ...init, headers });
}

export async function readDeferredDataResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith(FARM_DEFERRED_CONTENT_TYPE)) {
    return (await response.json()) as T;
  }
  if (!response.body) {
    throw new DeferredDataError("Deferred route data response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const controllers = new Map<string, ControlledDeferred>();
  let buffer = "";
  let complete = false;

  const readLine = async (): Promise<string | undefined> => {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return line;
      }
      if (complete) {
        if (!buffer) return undefined;
        const line = buffer;
        buffer = "";
        return line;
      }

      const chunk = await reader.read();
      complete = chunk.done;
      if (chunk.value) buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (chunk.done) buffer += decoder.decode();
    }
  };

  const firstLine = await readLine();
  if (!firstLine) {
    reader.releaseLock();
    throw new DeferredDataError("Deferred route data response is empty");
  }

  const initial = parseDeferredMessage(firstLine);
  if (initial.type !== "data") {
    reader.releaseLock();
    throw new DeferredDataError("Deferred route data response is invalid");
  }
  const data = reviveDeferredValue(initial.data, controllers) as T;

  void (async () => {
    try {
      for (let line = await readLine(); line !== undefined; line = await readLine()) {
        if (!line) continue;
        const message = parseDeferredMessage(line);
        if (message.type === "resolve") {
          const controller = getControlledDeferred(message.id, controllers);
          controller.resolve(reviveDeferredValue(message.data, controllers));
        } else if (message.type === "reject") {
          getControlledDeferred(message.id, controllers).reject(
            new DeferredDataError(message.error?.message),
          );
        }
      }
      rejectPendingDeferred(controllers, "Deferred route data stream ended before completion");
    } catch {
      rejectPendingDeferred(controllers, "Deferred route data stream could not be read");
    } finally {
      reader.releaseLock();
    }
  })();

  return data;
}

interface EncodingContext {
  records: DeferredRecord[];
  ids: Map<Deferred<unknown>, string>;
  nextId: number;
}

interface ControlledDeferred {
  promise: Promise<unknown> & {
    status?: "pending" | "fulfilled" | "rejected";
    value?: unknown;
    reason?: unknown;
  };
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

function createEncodingContext(records: readonly DeferredRecord[] = []): EncodingContext {
  return {
    records: [...records],
    ids: new Map(records.map((record) => [record.promise, record.id])),
    nextId: records.reduce((highest, record) => {
      const value = Number(record.id.replace(/^d/, ""));
      return Number.isFinite(value) ? Math.max(highest, value + 1) : highest;
    }, records.length),
  };
}

function encodeDeferredValue(
  value: unknown,
  context: EncodingContext,
  ancestors: WeakSet<object>,
): unknown {
  if (isDeferred(value)) {
    let id = context.ids.get(value);
    if (!id) {
      id = `d${context.nextId++}`;
      context.ids.set(value, id);
      context.records.push({ id, promise: value as Deferred<unknown> });
    }
    return { [FARM_DEFERRED_MARKER]: id };
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    assertNotCircular(value, ancestors);
    const output = value.map((item) => encodeDeferredValue(item, context, ancestors));
    ancestors.delete(value);
    return output;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  assertNotCircular(value, ancestors);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = encodeDeferredValue(item, context, ancestors);
  }
  ancestors.delete(value);
  return output;
}

function reviveDeferredValue(
  value: unknown,
  controllers: Map<string, ControlledDeferred>,
  settlements?: DeferredSettlements,
  applyingSettlements = new Set<string>(),
): unknown {
  if (isDeferredMarker(value)) {
    const id = value[FARM_DEFERRED_MARKER];
    const controller = getControlledDeferred(id, controllers);
    const settlement = settlements?.[id];
    if (settlement && controller.promise.status === "pending") {
      if (applyingSettlements.has(id)) return controller.promise;
      applyingSettlements.add(id);
      if (settlement.status === "fulfilled") {
        controller.resolve(
          reviveDeferredValue(settlement.value, controllers, settlements, applyingSettlements),
        );
      } else {
        controller.reject(new DeferredDataError(settlement.error.message));
      }
      applyingSettlements.delete(id);
    } else if (settlements && controller.promise.status === "pending") {
      controller.reject(new DeferredDataError("Deferred route data was not resolved"));
    }
    return controller.promise;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      reviveDeferredValue(item, controllers, settlements, applyingSettlements),
    );
  }
  if (!value || typeof value !== "object") return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = reviveDeferredValue(item, controllers, settlements, applyingSettlements);
  }
  return output;
}

function getControlledDeferred(
  id: string,
  controllers: Map<string, ControlledDeferred>,
): ControlledDeferred {
  const existing = controllers.get(id);
  if (existing) return existing;

  let nativeResolve!: (value: unknown) => void;
  let nativeReject!: (error: unknown) => void;
  const promise = new Promise<unknown>((resolve, reject) => {
    nativeResolve = resolve;
    nativeReject = reject;
  }) as ControlledDeferred["promise"];
  promise.status = "pending";
  promise.catch(() => undefined);

  const controlled: ControlledDeferred = {
    promise,
    resolve(value) {
      if (promise.status !== "pending") return;
      promise.status = "fulfilled";
      promise.value = value;
      nativeResolve(value);
    },
    reject(error) {
      if (promise.status !== "pending") return;
      promise.status = "rejected";
      promise.reason = error;
      nativeReject(error);
    },
  };
  controllers.set(id, controlled);
  return controlled;
}

function readDeferredState(promise: Deferred<unknown>): DeferredState {
  const tracked = deferredStates.get(promise);
  if (tracked && tracked.status !== "pending") return tracked;

  const reactState = promise as Deferred<unknown> & {
    status?: string;
    value?: unknown;
    reason?: unknown;
  };
  if (reactState.status === "fulfilled") {
    return { status: "fulfilled", value: reactState.value };
  }
  if (reactState.status === "rejected") {
    return { status: "rejected", reason: reactState.reason };
  }
  return tracked || { status: "pending" };
}

function isDeferredMarker(value: unknown): value is { [FARM_DEFERRED_MARKER]: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[FARM_DEFERRED_MARKER] === "string",
  );
}

function assertNotCircular(value: object, ancestors: WeakSet<object>): void {
  if (ancestors.has(value)) {
    throw new TypeError("Deferred route data must be JSON-serializable and cannot be circular");
  }
  ancestors.add(value);
}

function createDeferredPublicError() {
  return {
    code: FARM_DEFERRED_ERROR_CODE,
    message: "Deferred route data failed to load",
  } as const;
}

function createRejectedSettlement(): DeferredSettlement {
  return { status: "rejected", error: createDeferredPublicError() };
}

function reportDeferredError(
  options: DeferredDataResponseOptions,
  error: unknown,
  id: string,
): void {
  try {
    options.onError?.(error, id);
  } catch {
    // Error reporting must not break the response stream.
  }
}

function encodeDeferredMessage(message: Record<string, unknown>): string {
  return `${JSON.stringify(message)}\n`;
}

function parseDeferredMessage(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    throw new DeferredDataError("Deferred route data response contains invalid JSON");
  }
}

function rejectPendingDeferred(
  controllers: Map<string, ControlledDeferred>,
  message: string,
): void {
  for (const controller of controllers.values()) {
    if (controller.promise.status === "pending") {
      controller.reject(new DeferredDataError(message));
    }
  }
}
