import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFarmAuthIntegration } from "../src/internal.js";
import { auth } from "../src/server.js";

const root = await mkdtemp(path.join(os.tmpdir(), "farm-auth-test-"));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Farm Auth runtime", () => {
  it("signs up and exposes the same session through the server helper", async () => {
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
        session: {
          expiresIn: 60 * 60 * 24 * 7,
          updateAge: 60 * 60 * 24,
        },
        database: {
          path: ".farm/auth.sqlite",
          migrateInDevelopment: true,
        },
      },
      { root, mode: "development" },
    );

    const response = await integration.routes[0].handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          name: "Farm User",
          email: "person@farm.test",
          password: "secret123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const session = await auth.session({
      request: new Request("http://localhost:3000/dashboard", {
        headers: { cookie: cookie! },
      }),
      required: true,
    });

    expect(session.user.email).toBe("person@farm.test");
  });

  it("returns a 401 response for a required anonymous session", async () => {
    try {
      await auth.session({
        request: new Request("http://localhost:3000/dashboard"),
        required: true,
      });
      throw new Error("Expected auth.session to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(401);
      await expect((error as Response).json()).resolves.toMatchObject({
        code: "FARM_AUTH_REQUIRED",
      });
    }
  });
});
