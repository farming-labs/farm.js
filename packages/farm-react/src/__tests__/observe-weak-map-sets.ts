import { onTestFinished } from "vitest";

/** Observe native writes without spying on the WeakMap used by Vitest's spy bookkeeping. */
export function observeWeakMapSets(observe: (key: object, value: unknown) => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "set")!;
  onTestFinished(() => {
    Object.defineProperty(WeakMap.prototype, "set", descriptor);
  });
  Object.defineProperty(WeakMap.prototype, "set", {
    ...descriptor,
    value(this: WeakMap<object, unknown>, key: object, value: unknown) {
      observe(key, value);
      return Reflect.apply(descriptor.value, this, [key, value]);
    },
  });
}
