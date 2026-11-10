/**
 * React's `cache` for server code in islands mode. React exports `cache` from both of its builds,
 * but only the `react-server` build, which React Server Components render with, memoizes: the
 * default build calls the function every time. Islands render server components with the default
 * build, so Farm points a server module's `cache` import from `react` here: one result per
 * function and arguments for the current request, as RSC keeps it. Outside a request it calls
 * through, as React's does.
 */
import { after } from "./after";
import { getCurrentRequestOrNull } from "./server/request";

interface CacheNode {
  status: 0 | 1 | 2;
  value?: unknown;
  primitives?: Map<unknown, CacheNode>;
  objects?: WeakMap<object, CacheNode>;
}

// Per request: each memoized function's argument tree. Requests are collected with their caches.
const requests = new WeakMap<Request, WeakMap<object, CacheNode>>();

export function cache<Fn extends (...args: any[]) => any>(fn: Fn): Fn {
  // Each call to cache() is its own cache, even for the same function, as React's is.
  const memoized = function (this: unknown, ...args: unknown[]) {
    const request = getCurrentRequestOrNull();
    if (!request) return fn.apply(this, args);
    let functions = requests.get(request);
    if (!functions) requests.set(request, (functions = new WeakMap()));
    let node: CacheNode | undefined = functions.get(memoized);
    if (!node) {
      node = { status: 0 };
      functions.set(memoized, node);
    }
    for (const arg of args) {
      const keyed = (typeof arg === "object" && arg !== null) || typeof arg === "function";
      let next: CacheNode | undefined;
      if (keyed) {
        const objects: WeakMap<object, CacheNode> = (node.objects ??= new WeakMap());
        next = objects.get(arg as object);
        if (!next) objects.set(arg as object, (next = { status: 0 }));
      } else {
        const primitives: Map<unknown, CacheNode> = (node.primitives ??= new Map());
        next = primitives.get(arg);
        if (!next) primitives.set(arg, (next = { status: 0 }));
      }
      node = next;
    }
    if (node.status === 1) return node.value;
    if (node.status === 2) throw node.value;
    try {
      const value = fn.apply(this, args);
      node.status = 1;
      node.value = value;
      return value;
    } catch (error) {
      node.status = 2;
      node.value = error;
      throw error;
    }
  } as Fn;
  return memoized;
}

const signals = new WeakMap<Request, AbortController>();

/**
 * React's `cacheSignal` for server code in islands mode: an `AbortSignal` for the current request
 * that aborts once its response has finished, when React Server Components end the render's cache
 * lifetime. Cached work can pass it to `fetch` to stop when nobody needs the result. Outside a
 * request it returns null, as React's does.
 */
export function cacheSignal(): AbortSignal | null {
  const request = getCurrentRequestOrNull();
  if (!request) return null;
  let controller = signals.get(request);
  if (!controller) {
    controller = new AbortController();
    signals.set(request, controller);
    const aborting = controller;
    try {
      after(() => aborting.abort());
    } catch {
      // A request without Farm's post-response lifecycle (a test, a bare handler): the signal
      // stays open, as no render end is known.
    }
  }
  return controller.signal;
}
