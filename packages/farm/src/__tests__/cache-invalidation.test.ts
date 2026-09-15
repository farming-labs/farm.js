import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFarmCacheInvalidations,
  notifyFarmCacheInvalidation,
  notifyFarmCacheTask,
  subscribeFarmCacheInvalidation,
  subscribeFarmCacheTask,
} from "../cache-invalidation";

describe("cache invalidation listener isolation", () => {
  const cleanups: Array<() => void> = [];
  let warn: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    cleanups.splice(0).forEach((dispose) => dispose());
    warn?.mockRestore();
  });

  it("keeps notifying listeners after one throws", () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    cleanups.push(
      subscribeFarmCacheInvalidation(() => {
        throw new Error("boom");
      }),
    );
    cleanups.push(subscribeFarmCacheInvalidation((key) => seen.push(key)));

    expect(() => notifyFarmCacheInvalidation("product:1")).not.toThrow();
    expect(seen).toEqual(["product:1"]);
    expect(warn).toHaveBeenCalled();
  });

  it("applies every key in a batch even when a listener throws on an earlier one", () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    cleanups.push(
      subscribeFarmCacheInvalidation((key) => {
        seen.push(key);
        if (key === "a") throw new Error("boom");
      }),
    );

    expect(() => applyFarmCacheInvalidations(["a", "b"])).not.toThrow();
    expect(seen).toEqual(["a", "b"]);
  });

  it("isolates a throwing cache-task listener", () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: Array<Promise<void>> = [];
    cleanups.push(
      subscribeFarmCacheTask(() => {
        throw new Error("boom");
      }),
    );
    cleanups.push(subscribeFarmCacheTask((task) => seen.push(task)));

    const task = Promise.resolve();
    expect(() => notifyFarmCacheTask(task)).not.toThrow();
    expect(seen).toEqual([task]);
  });
});
