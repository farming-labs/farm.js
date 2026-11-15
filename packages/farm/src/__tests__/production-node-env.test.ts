import { describe, expect, it } from "vitest";
import {
  createReactProductionModePlugin,
  withProductionNodeEnv,
} from "../build/production-node-env";

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

describe("production NODE_ENV scopes", { concurrent: false }, () => {
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

describe("createReactProductionModePlugin", () => {
  const entry = `if (process.env.NODE_ENV === "production") module.exports = require("./prod.js");
else module.exports = require("./dev.js");`;

  it("keeps only the production builds of React, React DOM and React's Flight runtime", () => {
    const { transform } = createReactProductionModePlugin();
    for (const id of [
      "/app/node_modules/.pnpm/react@19.2.8/node_modules/react/index.js",
      "/app/node_modules/.pnpm/react-dom@19.2.8/node_modules/react-dom/server.edge.js",
      "/app/node_modules/react-server-dom-webpack/client.edge.js",
      // The copy @vitejs/plugin-rsc uses when it doesn't take the app's.
      "/app/node_modules/@vitejs/plugin-rsc/dist/vendor/react-server-dom/client.edge.js",
    ]) {
      expect(transform.filter.id.test(id)).toBe(true);
      expect(transform.handler(entry, id)?.code).toBe(
        entry.replace("process.env.NODE_ENV", '"production"'),
      );
    }
  });

  it("leaves other packages reading NODE_ENV at runtime", () => {
    const { transform } = createReactProductionModePlugin();
    const id = "/app/node_modules/react-markdown/index.js";
    expect(transform.filter.id.test(id)).toBe(false);
    expect(transform.handler(entry, id)).toBeNull();
  });
});
