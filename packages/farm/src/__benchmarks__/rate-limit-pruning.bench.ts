// @vitest-environment node
import assert from "node:assert/strict";
import { bench, describe } from "vitest";
import { memoryRateLimitStorage } from "../middleware/chain";
import { memoryRateLimitStorage as previousStorage } from "./controls/rate-limit-storage";

const previous = previousStorage();
const current = memoryRateLimitStorage();
const windowMs = 3_600_000;
for (let index = 0; index < 100_000; index++) {
  previous.increment(`key-${index}`, windowMs);
  current.increment(`key-${index}`, windowMs);
}
for (const storage of [previous, current]) {
  assert.throws(() => storage.increment("unknown", windowMs), /active-key capacity/);
  assert.equal((storage.increment("key-0", windowMs) as { count: number }).count, 2);
}
let _sink: unknown;
describe("full default 100,000-key memory rate limiter, no expired windows", () => {
  bench("previous rejected new key", () => {
    try {
      previous.increment("unknown", windowMs);
    } catch (error) {
      _sink = error;
    }
  });
  bench("expiry-aware rejected new key", () => {
    try {
      current.increment("unknown", windowMs);
    } catch (error) {
      _sink = error;
    }
  });
});
describe("accepted increment of an existing active key", () => {
  bench("previous existing key", () => {
    _sink = previous.increment("key-0", windowMs);
  });
  bench("snapshot existing key", () => {
    _sink = current.increment("key-0", windowMs);
  });
});
