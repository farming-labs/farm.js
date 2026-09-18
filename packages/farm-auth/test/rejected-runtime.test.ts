import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFarmAuthConfig } from "../src/config.js";
import { configureFarmAuth, disposeFarmAuth, getFarmAuthRuntime } from "../src/runtime.js";

const STATE_KEY: symbol = Symbol.for("@farm.js/auth/runtime");

interface RuntimeState {
  runtime?: Promise<unknown> | undefined;
  database?: unknown;
  config?: unknown;
  options?: unknown;
}

const readState = (): RuntimeState | undefined =>
  (globalThis as Record<symbol, RuntimeState | undefined>)[STATE_KEY];

const SECRET_ENV = [
  "FARM_AUTH_SECRET",
  "AUTH_SECRET",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
] as const;
const savedEnv: Record<string, string | undefined> = {};
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "farm-auth-rejected-"));
  for (const name of SECRET_ENV) savedEnv[name] = process.env[name];
});

afterAll(async () => {
  for (const name of SECRET_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  await disposeFarmAuth();
  await rm(root, { recursive: true, force: true });
});

function clearSecretEnv(): void {
  for (const name of SECRET_ENV) delete process.env[name];
}

const baseConfig = resolveFarmAuthConfig(true);

describe("getFarmAuthRuntime cache recovery after a rejection", () => {
  it("frees the cache when createRuntime rejects instead of pinning the rejected promise", async () => {
    // A rejected Promise is truthy, so the original `if (!state.runtime)` check
    // stayed permanently satisfied and every later call returned the same
    // rejected promise. The rejection handler must clear the cache so the next
    // call retries, without relying on a reconfigure to reset it.
    clearSecretEnv();
    configureFarmAuth(baseConfig, { root, mode: "production" });

    await expect(getFarmAuthRuntime()).rejects.toThrow(/FARM_AUTH_SECRET/);

    expect(readState()?.runtime).toBeUndefined();
    expect(readState()?.database).toBeUndefined();
  });

  it("is safe to dispose after a rejection and does not double-close the database", async () => {
    // The rejection handler closes a connection that createRuntime registered
    // before failing (e.g. a dev migration failure). disposeFarmAuth must still
    // be callable afterward without throwing or closing the same handle twice.
    clearSecretEnv();
    configureFarmAuth(baseConfig, { root, mode: "production" });
    await expect(getFarmAuthRuntime()).rejects.toThrow(/FARM_AUTH_SECRET/);

    await expect(disposeFarmAuth()).resolves.toBeUndefined();
    expect(readState()?.runtime).toBeUndefined();
    expect(readState()?.database).toBeUndefined();
  });

  it("still caches the runtime on success after earlier rejections", async () => {
    clearSecretEnv();
    configureFarmAuth(baseConfig, { root, mode: "development" });

    const runtime = await getFarmAuthRuntime();
    expect(typeof runtime.handler).toBe("function");

    const cached = readState()?.runtime;
    expect(cached).toBeDefined();

    // The rejection handler must not fire on the success path: the same resolved
    // promise stays cached and subsequent calls return the same runtime.
    const again = await getFarmAuthRuntime();
    expect(again).toBe(runtime);
    expect(readState()?.runtime).toBe(cached);

    await disposeFarmAuth();
  });
});
