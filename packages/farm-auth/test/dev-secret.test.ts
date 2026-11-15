import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFarmAuthConfig } from "../src/config.js";
import { createFarmAuthIntegration, disposeFarmAuth } from "../src/internal.js";
import { auth } from "../src/server.js";

// Better Auth signs sessions and email verification tokens with this secret. The
// old fallback was a constant in the published package, so anyone who reached a
// dev server could forge a change-email token for any known address.
const OLD_PUBLIC_SECRET = "farm-auth-development-or-migration-secret";
const SECRET_ENV = ["FARM_AUTH_SECRET", "AUTH_SECRET", "BETTER_AUTH_SECRET", "DATABASE_URL"];
const savedEnv: Record<string, string | undefined> = {};
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "farm-auth-secret-"));
  for (const name of SECRET_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterAll(async () => {
  await disposeFarmAuth();
  for (const name of SECRET_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  await rm(root, { recursive: true, force: true });
});

const config = resolveFarmAuthConfig(true);

function startRuntime() {
  return createFarmAuthIntegration(config, { root, mode: "development" });
}

async function signUp(email: string): Promise<string> {
  const response = await startRuntime().routes[0].handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Farm User", email, password: "secret123" }),
    }),
  );
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!;
}

function readSession(cookie: string) {
  return auth.session({
    request: new Request("http://localhost:3000/dashboard", { headers: { cookie } }),
  });
}

describe("Farm Auth development secret", () => {
  it("generates a random secret in the app's .farm directory, not a public constant", async () => {
    const cookie = await signUp("first@farm.test");
    const file = path.join(root, ".farm", "auth-secret");

    const secret = (await readFile(file, "utf8")).trim();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toBe(OLD_PUBLIC_SECRET);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o077).toBe(0);
    // Resolved against the app root, not the process working directory.
    await expect(access(path.join(process.cwd(), ".farm", "auth-secret"))).rejects.toThrow();

    await expect(readSession(cookie)).resolves.toMatchObject({
      user: { email: "first@farm.test" },
    });
  });

  it("reuses the persisted secret when the runtime is created again", async () => {
    const cookie = await signUp("second@farm.test");
    const file = path.join(root, ".farm", "auth-secret");
    const before = await readFile(file, "utf8");

    await disposeFarmAuth();
    startRuntime();

    await expect(readFile(file, "utf8")).resolves.toBe(before);
    await expect(readSession(cookie)).resolves.toMatchObject({
      user: { email: "second@farm.test" },
    });

    // The runtime signs with the file's value: replacing it invalidates the session.
    await writeFile(file, `${"a".repeat(64)}\n`);
    await disposeFarmAuth();
    startRuntime();
    await expect(readSession(cookie)).resolves.toBeNull();
  });
});
