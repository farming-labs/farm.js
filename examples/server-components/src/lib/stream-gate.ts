// Holds /stream's slow content, by token, until a request releases it: the contract's tests can
// then act on the page while its body is still streaming, instead of racing a server timer. Kept
// on globalThis, as after-log.ts is, so the release reaches the render it holds on any runtime.
interface Gate {
  promise: Promise<void>;
  release(): void;
}

const key = Symbol.for("farm.contract.stream-gate");
// A test that fails before it releases its token must not hold the render open for good.
const HOLD_LIMIT_MS = 30_000;

function gates(): Map<string, Gate> {
  const store = globalThis as { [key]?: Map<string, Gate> };
  return (store[key] ??= new Map());
}

function gate(token: string): Gate {
  let entry = gates().get(token);
  if (!entry) {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    entry = { promise, release };
    gates().set(token, entry);
  }
  return entry;
}

/** Resolves once `token` is released, whether the release came first or comes later. */
export function heldUntilReleased(token: string): Promise<void> {
  const entry = gate(token);
  const limit = setTimeout(entry.release, HOLD_LIMIT_MS);
  return entry.promise.finally(() => {
    clearTimeout(limit);
    gates().delete(token);
  });
}

export function releaseHeld(token: string): void {
  gate(token).release();
}
