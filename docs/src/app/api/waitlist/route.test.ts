// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAPIRouteEndpoint } from "@farm.js/core/api/runtime";
import { POST } from "./route";

const prismaMocks = vi.hoisted(() => ({
  upsert: vi.fn().mockResolvedValue({ id: "test-id" }),
}));

vi.mock("../../../lib/prisma", () => ({
  getWaitlistPrisma: async () => {
    if (!process.env.WAITLIST_DATABASE_URL && !process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not configured");
    }
    return { waitlistEntry: prismaMocks };
  },
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalWaitlistDatabaseUrl = process.env.WAITLIST_DATABASE_URL;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete process.env.WAITLIST_DATABASE_URL;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  prismaMocks.upsert.mockReset();
  prismaMocks.upsert.mockResolvedValue({ id: "test-id" });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalWaitlistDatabaseUrl === undefined) delete process.env.WAITLIST_DATABASE_URL;
  else process.env.WAITLIST_DATABASE_URL = originalWaitlistDatabaseUrl;
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
      // Public, unauthenticated, and it writes to the database, so repeated
      // requests for one address have to hit the per-address rate limit.
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

  describe("existing entries", () => {
    it("keeps the first description when someone resubmits an address", async () => {
      // Back the mock with real upsert semantics so the test sees what is stored.
      const rows = new Map<string, { id: string; description: string }>();
      prismaMocks.upsert.mockImplementation(
        async ({
          where,
          create,
          update,
        }: {
          where: { email: string };
          create: { email: string; description: string };
          update: { description?: string };
        }) => {
          const existing = rows.get(where.email);
          const row = existing
            ? { ...existing, ...update }
            : { id: `entry-${rows.size + 1}`, description: create.description };
          rows.set(where.email, row);
          return { id: row.id };
        },
      );
      process.env.DATABASE_URL = "postgres://waitlist.test/db";
      const email = `owner-${Date.now()}@example.com`;

      const first = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email, description: "Building a support agent" }),
      );
      // Anyone can submit any address, so a second submission must not be able
      // to replace what the owner wrote.
      const second = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email, description: "Replaced by someone else" }),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ ok: true });
      expect(rows.get(email)?.description).toBe("Building a support agent");
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
    it("accepts signups with only a dedicated waitlist database configured", async () => {
      delete process.env.DATABASE_URL;
      process.env.WAITLIST_DATABASE_URL = "postgresql://test/waitlist";
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "dedicated@example.com", description: "Agent infrastructure" }),
      );
      await expect(response.json()).resolves.toEqual({ ok: true, id: "test-id" });
      expect(prismaMocks.upsert).toHaveBeenCalledTimes(1);
    });

    it("accepts the blog's agent infrastructure signup using the existing schema", async () => {
      process.env.DATABASE_URL = "postgresql://test/farmjs";
      const description = "Agent infrastructure early access — Farm.js v0.1.0 blog";
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "agent-reader@example.com", description }),
      );

      await expect(response.json()).resolves.toEqual({ ok: true, id: "test-id" });
      expect(prismaMocks.upsert).toHaveBeenCalledWith({
        where: { email: "agent-reader@example.com" },
        update: {},
        create: { email: "agent-reader@example.com", description },
        select: { id: true },
      });
    });

    it("accepts a signup from the dedicated agents page", async () => {
      process.env.DATABASE_URL = "postgresql://test/farmjs";
      const description = "Agent infrastructure early access — Farm.js agents page";
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "agents-page@example.com", description }),
      );
      await expect(response.json()).resolves.toEqual({ ok: true, id: "test-id" });
      expect(prismaMocks.upsert).toHaveBeenCalledWith({
        where: { email: "agents-page@example.com" },
        update: {},
        create: { email: "agents-page@example.com", description },
        select: { id: true },
      });
    });

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
        update: {},
        create: { email: "user@example.com", description: "auth and data" },
        select: { id: true },
      });
    });
  });

  describe("database failures (the reachable { ok: false } branch)", () => {
    it("does not report a configured dedicated database as missing when it is unavailable", async () => {
      delete process.env.DATABASE_URL;
      process.env.WAITLIST_DATABASE_URL = "postgresql://test/waitlist";
      prismaMocks.upsert.mockRejectedValueOnce(new Error("connection refused"));
      const response = await invokeAPIRouteEndpoint(
        POST,
        waitlistRequest({ email: "unavailable@example.com", description: "Agent infrastructure" }),
      );
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Could not join the waitlist yet. Please try again in a moment.",
      });
    });

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
