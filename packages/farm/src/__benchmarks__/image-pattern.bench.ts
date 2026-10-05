import assert from "node:assert/strict";
import { bench, describe } from "vitest";
import { matchesImagePathPattern } from "../image-pattern";

// Exact previous matchesGlob implementation from image-server.ts at 4c7b1017.
function previousMatchesGlob(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  // eslint-disable-next-line no-control-regex -- Preserve the previous glob implementation exactly.
  const source = escaped.replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*");
  return new RegExp(`^${source}$`).test(value);
}

const patterns = Array.from({ length: 25 }, (_, index) => ({ pathname: `/assets-${index}/**` }));
for (const value of ["/assets-24/a.png", "/assets-0/nested/a.png", "/private/a.png"]) {
  for (const pattern of patterns) {
    assert.equal(
      matchesImagePathPattern(value, pattern),
      previousMatchesGlob(value, pattern.pathname),
    );
  }
}
let _sink: boolean;
describe("image pathname policy matching (25 patterns)", () => {
  bench("cached pattern", () => {
    _sink = patterns.some((pattern) => matchesImagePathPattern("/assets-24/a.png", pattern));
  });
  bench("previous compilation per lookup", () => {
    _sink = patterns.some((pattern) => previousMatchesGlob("/assets-24/a.png", pattern.pathname));
  });
});
