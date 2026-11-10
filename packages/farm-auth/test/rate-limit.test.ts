import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Better Auth only enables its rate limiter in production.
const previousEnv = { NODE_ENV: process.env.NODE_ENV, TEST: process.env.TEST };
process.env.NODE_ENV = "production";
delete process.env.TEST;
const { createFarmAuthIntegration, disposeFarmAuth } = await import("../src/internal.js");

const root = await mkdtemp(path.join(os.tmpdir(), "farm-auth-rate-limit-"));

afterAll(async () => {
  await disposeFarmAuth();
  await rm(root, { recursive: true, force: true });
  process.env.NODE_ENV = previousEnv.NODE_ENV;
  if (previousEnv.TEST !== undefined) process.env.TEST = previousEnv.TEST;
});

const origin = "http://localhost:3000";

describe("Farm Auth rate limiting", () => {
  // "development" only for the local SQLite store; the limiter follows NODE_ENV.
  const integration = createFarmAuthIntegration(
    {
      enabled: true,
      basePath: "/api/auth",
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      },
      session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
      database: { path: ".farm/auth.sqlite", migrateInDevelopment: true },
    },
    { root, mode: "development" },
  );

  // The shape Farm hands integration routes: the resolved address on `socket`.
  const signIn = (address: string | undefined, headers: Record<string, string> = {}) => {
    const request = new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify({ email: "victim@farm.test", password: "wrong-password" }),
    });
    if (address) Object.assign(request, { socket: { remoteAddress: address } });
    return integration.routes[0].handler(request);
  };

  it("ignores client-supplied forwarding headers", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 6; index++) {
      const response = await signIn("203.0.113.10", {
        "x-forwarded-for": `198.51.100.${index}`,
        "x-farm-auth-client-address": `192.0.2.${index}`,
      });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });

  it("gives each real client its own bucket", async () => {
    let limited = false;
    for (let index = 0; index < 6 && !limited; index++) {
      limited = (await signIn("203.0.113.20")).status === 429;
    }
    expect(limited).toBe(true);

    const other = await signIn("203.0.113.21");
    expect(other.status).not.toBe(429);
  });
});
