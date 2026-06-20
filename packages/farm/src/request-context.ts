type RequestContextCarrier = object;

export interface SetRequestContextOptions {
  exposeToPage?: boolean;
}

export interface RequestContextSnapshotOptions {
  exposedOnly?: boolean;
}

interface RequestContextBucket {
  privateData: Map<string, any>;
  exposedData: Map<string, any>;
}

const REQUEST_CONTEXT_STORE_KEY = Symbol.for("farm.requestContextStore");

type GlobalWithRequestContextStore = typeof globalThis & {
  [REQUEST_CONTEXT_STORE_KEY]?: WeakMap<RequestContextCarrier, RequestContextBucket>;
};

function getRequestContextStore() {
  const globalState = globalThis as GlobalWithRequestContextStore;
  if (!globalState[REQUEST_CONTEXT_STORE_KEY]) {
    globalState[REQUEST_CONTEXT_STORE_KEY] = new WeakMap<
      RequestContextCarrier,
      RequestContextBucket
    >();
  }

  return globalState[REQUEST_CONTEXT_STORE_KEY]!;
}

function getBucket(target: RequestContextCarrier): RequestContextBucket {
  const requestContextStore = getRequestContextStore();
  let bucket = requestContextStore.get(target);
  if (!bucket) {
    bucket = {
      privateData: new Map<string, any>(),
      exposedData: new Map<string, any>(),
    };
    requestContextStore.set(target, bucket);
  }
  return bucket;
}

export function setRequestContext(
  target: RequestContextCarrier,
  key: string,
  value: any,
  options: SetRequestContextOptions = {},
): void {
  const bucket = getBucket(target);
  bucket.privateData.set(key, value);
  if (options.exposeToPage) {
    bucket.exposedData.set(key, value);
  }
}

export function getRequestContext<T = any>(
  target: RequestContextCarrier,
  key: string,
): T | undefined {
  const requestContextStore = getRequestContextStore();
  const bucket = requestContextStore.get(target);
  return bucket?.privateData.get(key) as T | undefined;
}

export function hasRequestContext(target: RequestContextCarrier, key: string): boolean {
  const requestContextStore = getRequestContextStore();
  const bucket = requestContextStore.get(target);
  return bucket?.privateData.has(key) ?? false;
}

export function deleteRequestContext(target: RequestContextCarrier, key: string): boolean {
  const requestContextStore = getRequestContextStore();
  const bucket = requestContextStore.get(target);
  if (!bucket) return false;
  const removedPrivate = bucket.privateData.delete(key);
  bucket.exposedData.delete(key);
  return removedPrivate;
}

export function clearRequestContext(target: RequestContextCarrier): void {
  const requestContextStore = getRequestContextStore();
  const bucket = requestContextStore.get(target);
  if (!bucket) return;
  bucket.privateData.clear();
  bucket.exposedData.clear();
}

export function getRequestContextSnapshot(
  target: RequestContextCarrier,
  options: RequestContextSnapshotOptions = {},
): Map<string, any> {
  const requestContextStore = getRequestContextStore();
  const bucket = requestContextStore.get(target);
  if (!bucket) return new Map<string, any>();
  if (options.exposedOnly) {
    return new Map(bucket.exposedData);
  }
  return new Map(bucket.privateData);
}
