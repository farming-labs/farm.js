import { describe, expect, it } from "vitest";
import { withProductionNodeEnv } from "../build/production-node-env";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function restoreNodeEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
}

describe.sequential("production NODE_ENV scopes", () => {
  it("keeps production pinned until overlapping operations both settle", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const finishFirst = deferred<void>();
    const finishSecond = deferred<void>();

    try {
      process.env.NODE_ENV = "development";
      const first = withProductionNodeEnv(async () => {
        firstStarted.resolve();
        await finishFirst.promise;
        expect(process.env.NODE_ENV).toBe("production");
      });
      await firstStarted.promise;

      const second = withProductionNodeEnv(async () => {
        secondStarted.resolve();
        await finishSecond.promise;
        expect(process.env.NODE_ENV).toBe("production");
      });
      await secondStarted.promise;

      expect(process.env.NODE_ENV).toBe("production");
      finishFirst.resolve();
      await first;
      expect(process.env.NODE_ENV).toBe("production");

      finishSecond.resolve();
      await second;
      expect(process.env.NODE_ENV).toBe("development");
    } finally {
      finishFirst.resolve();
      finishSecond.resolve();
      restoreNodeEnv(originalNodeEnv);
    }
  });

  it("restores an initially missing value after an overlapping rejection", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const finishFirst = deferred<void>();
    const rejectSecond = deferred<void>();

    try {
      delete process.env.NODE_ENV;
      const first = withProductionNodeEnv(async () => {
        await finishFirst.promise;
        expect(process.env.NODE_ENV).toBe("production");
      });
      const second = withProductionNodeEnv(async () => {
        await rejectSecond.promise;
        throw new Error("expected overlapping failure");
      });

      rejectSecond.resolve();
      await expect(second).rejects.toThrow("expected overlapping failure");
      expect(process.env.NODE_ENV).toBe("production");

      finishFirst.resolve();
      await first;
      expect(process.env.NODE_ENV).toBeUndefined();
    } finally {
      finishFirst.resolve();
      rejectSecond.resolve();
      restoreNodeEnv(originalNodeEnv);
    }
  });
});
