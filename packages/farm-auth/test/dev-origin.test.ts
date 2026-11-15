import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ResolvedFarmAuthConfig } from "../src/types.js";

// Better Auth skips its origin check under NODE_ENV=test or TEST, which would hide the bug.
const previousEnv = { ...process.env };
process.env.NODE_ENV = "development";
delete process.env.TEST;
for (const key of [
  "FARM_AUTH_URL",
  "BETTER_AUTH_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_BRANCH_URL",
]) {
  delete process.env[key];
}
const { createFarmAuthIntegration, disposeFarmAuth } = await import("../src/internal.js");
const { resolveFarmAuthBaseURL, resolveFarmAuthTrustedOrigins } = await import("../src/runtime.js");

const roots: string[] = [];

afterEach(async () => {
  await disposeFarmAuth();
  delete process.env.FARM_AUTH_URL;
});

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnv)) delete process.env[key];
  }
  Object.assign(process.env, previousEnv);
});

function config(basePath = "/api/auth"): ResolvedFarmAuthConfig {
  return {
    enabled: true,
    basePath,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    database: { path: ".farm/auth.sqlite", migrateInDevelopment: true },
  };
}

async function devIntegration(basePath?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-auth-dev-origin-"));
  roots.push(root);
  return createFarmAuthIntegration(config(basePath), { root, mode: "development" });
}

// The request Farm's dev server hands the route: its URL is built from the Host it accepted.
function post(url: string, origin: string, body: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const account = { name: "Farm User", email: "person@farm.test", password: "secret123" };

describe("farm dev trusts its own origin", () => {
  for (const serverOrigin of [
    "http://localhost:3311",
    "http://10.0.2.2:3311",
    "http://192.168.1.20:5173",
    "http://[::1]:3311",
    "http://app.localhost:3311",
  ]) {
    it(`signs up and signs in same-origin on ${serverOrigin}`, async () => {
      const integration = await devIntegration();
      const signUp = await integration.routes[0].handler(
        post(`${serverOrigin}/api/auth/sign-up/email`, serverOrigin, account),
      );
      expect(signUp.status).toBe(200);

      const signIn = await integration.routes[0].handler(
        post(`${serverOrigin}/api/auth/sign-in/email`, serverOrigin, {
          email: account.email,
          password: account.password,
        }),
      );
      expect(signIn.status).toBe(200);
      expect(signIn.headers.get("set-cookie")).toContain("session_token");
    });
  }

  it("follows a custom basePath", async () => {
    const integration = await devIntegration("/account/auth");
    expect(integration.routes[0].path).toBe("/account/auth/[...auth]");
    const response = await integration.routes[0].handler(
      post("http://10.0.2.2:3311/account/auth/sign-up/email", "http://10.0.2.2:3311", account),
    );
    expect(response.status).toBe(200);
  });

  for (const [label, url, origin] of [
    ["a cross-site page", "http://localhost:3311", "https://evil.example"],
    ["another local port", "http://localhost:3311", "http://localhost:4000"],
    ["another LAN host", "http://192.168.1.20:5173", "http://192.168.1.50:5173"],
    // DNS rebinding: Host and Origin agree, but the name is not one Vite allows by default.
    ["a rebound hostname", "http://evil.example:3311", "http://evil.example:3311"],
  ] as const) {
    it(`still rejects ${label}`, async () => {
      const integration = await devIntegration();
      const response = await integration.routes[0].handler(
        post(`${url}/api/auth/sign-up/email`, origin, account),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    });
  }

  it("lets FARM_AUTH_URL win when it is set", async () => {
    process.env.FARM_AUTH_URL = "http://app.localhost:4000";
    const integration = await devIntegration();

    const ownOrigin = await integration.routes[0].handler(
      post("http://localhost:3311/api/auth/sign-up/email", "http://localhost:3311", account),
    );
    expect(ownOrigin.status).toBe(403);
    await expect(ownOrigin.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });

    const configured = await integration.routes[0].handler(
      post(
        "http://app.localhost:4000/api/auth/sign-up/email",
        "http://app.localhost:4000",
        account,
      ),
    );
    expect(configured.status).toBe(200);
  });
});

describe("production trusted origins", () => {
  it("never trusts the request's own origin", () => {
    expect(resolveFarmAuthTrustedOrigins("production", {} as NodeJS.ProcessEnv)).toEqual([]);
    expect(
      resolveFarmAuthTrustedOrigins("production", {
        FARM_AUTH_URL: "https://app.example.com",
      } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("rejects a same-origin request that is not the configured URL", async () => {
    const env = { FARM_AUTH_URL: "https://app.example.com" } as NodeJS.ProcessEnv;
    const { DatabaseSync } = createRequire(import.meta.url)(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const options = {
      baseURL: resolveFarmAuthBaseURL("production", env),
      trustedOrigins: resolveFarmAuthTrustedOrigins("production", env),
      secret: "x".repeat(32),
      database: new DatabaseSync(":memory:"),
      emailAndPassword: { enabled: true },
    };
    const { getMigrations } = await import("better-auth/db/migration");
    await (await getMigrations(options)).runMigrations();
    const { betterAuth } = await import("better-auth");
    const instance = betterAuth(options);

    const local = await instance.handler(
      post("http://localhost:3311/api/auth/sign-up/email", "http://localhost:3311", account),
    );
    expect(local.status).toBe(403);
    await expect(local.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });

    const configured = await instance.handler(
      post("https://app.example.com/api/auth/sign-up/email", "https://app.example.com", account),
    );
    expect(configured.status).toBe(200);
    options.database.close();
  });
});
