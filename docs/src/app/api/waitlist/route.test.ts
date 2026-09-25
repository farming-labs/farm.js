// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAPIRouteEndpoint } from "@farm.js/core/api/runtime";
import { POST } from "./route";

const prismaMocks = vi.hoisted(() => ({
  upsert: vi.fn().mockResolvedValue({ id: "test-id" }),
}));

vi.mock("../../../lib/prisma", () => ({
  getPrisma: async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not configured");
    }
    return { waitlistEntry: prismaMocks };
  },
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  prismaMocks.upsert.mockReset();
  prismaMocks.upsert.mockResolvedValue({ id: "test-id" });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

function waitlistRequest(body: unknown): Request {
  return new Request("https://farmjs.dev/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("waitlist signup endpoint", () => {
  describe("abuse protection", () => {
    it("refuses a flood of submissions for the same address", async () => {
      // Public, unauthenticated, and it writes to the database. The upsert is
      // keyed on email, so a loop can also overwrite an existing entry's
      // description, not just add rows.
      const email = `flood-${Date.now()}@example.com`;
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await invokeAPIRouteEndpoint(
          POST,
          waitlistRequest({ email, description: "hello world" }),
        );
        statuses.push(response.status);
      }

      expect(statuses[0]).not.toBe(429);
      expect(statuses).toContain(429);
    });
  });

  describe("body validation (owned by the Farm runtime, not the handler)", () => {
    it("rejects an invalid email with the runtime 400 before the handler runs", async () => {
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "not-an-email", description: "hello world" }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid request body");
      expect(Array.isArray(json.details)).toBe(true);
      expect(prismaMocks.upsert).not.toHaveBeenCalled();
    });

    it("rejects a too-short description with the runtime 400 (the form-reachable trigger)", async () => {
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "user@example.com", description: "ab" }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid request body");
      expect(Array.isArray(json.details)).toBe(true);
      expect(prismaMocks.upsert).not.toHaveBeenCalled();
    });

    it("rejects a missing description with the runtime 400", async () => {
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "user@example.com" }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid request body");
      expect(prismaMocks.upsert).not.toHaveBeenCalled();
    });

    it("rejects an over-long description with the runtime 400", async () => {
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "user@example.com", description: "x".repeat(1201) }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid request body");
      expect(prismaMocks.upsert).not.toHaveBeenCalled();
    });

    it("rejects a non-object JSON body with the runtime 400", async () => {
      const response = await invokeAPIRouteEndpoint(POST, waitlistRequest("just a string"));

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid request body");
      expect(prismaMocks.upsert).not.toHaveBeenCalled();
    });
  });

  describe("successful signups (handler treats ctx.body as already-validated)", () => {
    it("accepts a valid signup and returns the persisted entry id", async () => {
      process.env.DATABASE_URL = "postgresql://test/farmjs";

      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "user@example.com", description: "hello world" }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, id: "test-id" });
    });

    it("normalizes the email to lower case and trims fields before persisting", async () => {
      process.env.DATABASE_URL = "postgresql://test/farmjs";

      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "  User@Example.COM  ", description: "  auth and data  " }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, id: "test-id" });
      expect(prismaMocks.upsert).toHaveBeenCalledTimes(1);
      expect(prismaMocks.upsert).toHaveBeenCalledWith({
        where: { email: "user@example.com" },
        update: { description: "auth and data" },
        create: { email: "user@example.com", description: "auth and data" },
        select: { id: true },
      });
    });
  });

  describe("database failures (the reachable { ok: false } branch)", () => {
    it("returns a friendly 200 envelope when the upsert fails and a database is configured", async () => {
      process.env.DATABASE_URL = "postgresql://test/farmjs";
      prismaMocks.upsert.mockRejectedValueOnce(new Error("connection refused"));

      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "user@example.com", description: "hello world" }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Could not join the waitlist yet. Please try again in a moment.",
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("returns a not-configured 200 envelope when DATABASE_URL is unset", async () => {
      delete process.env.DATABASE_URL;

      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "user@example.com", description: "hello world" }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Waitlist database is not configured yet.",
      });
      expect(prismaMocks.upsert).not.toHaveBeenCalled();
    });
  });
});
