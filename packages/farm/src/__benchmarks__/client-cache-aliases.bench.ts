// @vitest-environment node
import assert from "node:assert/strict";
import { bench, describe } from "vitest";
import { FarmClientDataCache } from "../client-cache";

type NotificationState = {
  aliases: Map<string, string>;
  resolveKey(key: string): string;
  notifyListeners(key: string, event?: "invalidate"): void;
};
// Previous emit method from 1307b964. All other cache behavior is identical.
function previousEmit(this: NotificationState, key: string, event?: "invalidate") {
  this.notifyListeners(key, event);
  for (const [alias, target] of this.aliases) {
    if (this.resolveKey(target) === key) this.notifyListeners(alias, event);
  }
}
const entry = { data: 1, updatedAt: 1, staleAt: Infinity };
function fixture(previous: boolean, subscribers: number) {
  const cache = new FarmClientDataCache({
    subscribeToInvalidation: false,
    gcSweepIntervalMs: false,
  });
  if (previous) Object.defineProperty(cache, "emit", { value: previousEmit });
  for (let index = 0; index < 1_000; index++) cache.alias(`alias-${index}`, "target");
  let notifications = 0;
  for (let index = 0; index < subscribers; index++)
    cache.subscribe(`alias-${index}`, () => {
      notifications++;
    });
  cache.set("target", entry);
  assert.equal(notifications, subscribers);
  return cache;
}
for (const subscribers of [0, 5, 1_000]) {
  describe(`write with 1,000 aliases and ${subscribers} subscribers`, () => {
    const previous = fixture(true, subscribers);
    const current = fixture(false, subscribers);
    bench("previous alias resolution", () => {
      previous.set("target", entry);
    });
    bench("skip unobserved aliases", () => {
      current.set("target", entry);
    });
  });
}
