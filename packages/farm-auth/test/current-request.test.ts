import { afterEach, describe, expect, it } from "vitest";
import { auth } from "../src/server.js";

const RESOLVER = Symbol.for("farm.currentRequestResolver");
type Global = typeof globalThis & { [RESOLVER]?: () => Request | undefined };

describe("Farm Auth current request", () => {
  const previous = (globalThis as Global)[RESOLVER];
  afterEach(() => {
    (globalThis as Global)[RESOLVER] = previous;
  });

  // Core's resolver throws inside unstable_cache(). auth.user() must read it on
  // every call, not a captured copy, so a cached function never gets a session.
  it("reads the request through core's resolver on every call", async () => {
    (globalThis as Global)[RESOLVER] = () => {
      throw new Error("cannot be called inside unstable_cache()");
    };

    await expect(auth.user()).rejects.toThrow(/unstable_cache\(\)/);
    await expect(auth.session()).rejects.toThrow(/unstable_cache\(\)/);
  });
});
