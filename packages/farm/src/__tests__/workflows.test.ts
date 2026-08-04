// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFarmWorkflowVercelCrons,
  createFarmWorkflowRequestHandler,
  defineCron,
  discoverFarmWorkflows,
  prepareFarmWorkflowsForNitro,
  resolveWorkflowsConfig,
} from "../workflows";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Farm workflows", () => {
  it("defines cron workflow modules with typed schedule metadata", () => {
    const cron = defineCron({
      id: "daily-digest",
      schedule: "0 9 * * *",
      description: "Send the daily digest.",
      async run(ctx) {
        return { id: ctx.id, payload: ctx.payload };
      },
    });

    expect(cron.kind).toBe("farm-workflow");
    expect(cron.schedule).toBe("0 9 * * *");
  });

  it("discovers file-based cron workflows from default directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflows-"));
    await fs.mkdir(path.join(root, "src", "jobs"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "jobs", "daily-cleanup.mjs"),
      [
        "export default {",
        "  schedule: '0 2 * * *',",
        "  description: 'Delete expired sessions.',",
        "  async run() { return { deleted: 1 }; }",
        "};",
      ].join("\n"),
    );

    const workflows = await discoverFarmWorkflows({ root });

    expect(workflows).toEqual([
      {
        id: "daily-cleanup",
        filePath: path.join(root, "src", "jobs", "daily-cleanup.mjs"),
        description: "Delete expired sessions.",
        schedule: ["0 2 * * *"],
        timezone: undefined,
        routePath: "/api/_farm/workflows/daily-cleanup",
      },
    ]);
  });

  it("runs workflow modules through the HTTP handler", async () => {
    const workflow = {
      id: "sync-users",
      filePath: "/virtual/sync-users.ts",
      description: "Sync users.",
      schedule: ["*/10 * * * *"],
      routePath: "/api/_farm/workflows/sync-users",
    };
    const run = vi.fn(async (ctx) => ({ received: ctx.payload }));
    const handler = createFarmWorkflowRequestHandler({
      workflows: [workflow],
      config: resolveWorkflowsConfig({ secret: "test-secret" }),
      loadModule: async () => ({
        default: {
          run,
        },
      }),
    });

    const unauthorized = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users", {
        method: "POST",
        body: JSON.stringify({ cursor: "abc" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(unauthorized?.status).toBe(401);

    const response = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users", {
        method: "POST",
        body: JSON.stringify({ cursor: "abc" }),
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-secret",
        },
      }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      id: "sync-users",
      ok: true,
      result: {
        received: {
          cursor: "abc",
        },
      },
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("protects workflow metadata and supports GET scheduler payloads", async () => {
    const workflow = {
      id: "sync-users",
      filePath: "/virtual/sync-users.ts",
      description: "Sync users.",
      schedule: ["*/10 * * * *"],
      routePath: "/api/_farm/workflows/sync-users",
    };
    const run = vi.fn(async (ctx) => ({ received: ctx.payload }));
    const handler = createFarmWorkflowRequestHandler({
      workflows: [workflow],
      config: resolveWorkflowsConfig({ secret: "test-secret" }),
      loadModule: async () => ({
        default: {
          run,
        },
      }),
    });

    const unauthorizedList = await handler(new Request("https://example.com/api/_farm/workflows"));
    expect(unauthorizedList?.status).toBe(401);

    const querySecret = await handler(
      new Request("https://example.com/api/_farm/workflows?secret=test-secret"),
    );
    expect(querySecret?.status).toBe(401);

    const list = await handler(
      new Request("https://example.com/api/_farm/workflows", {
        headers: { "x-farm-workflow-secret": "test-secret" },
      }),
    );
    await expect(list?.json()).resolves.toEqual({
      workflows: [
        {
          id: "sync-users",
          description: "Sync users.",
          schedule: ["*/10 * * * *"],
          timezone: null,
          path: "/api/_farm/workflows/sync-users",
        },
      ],
    });

    const response = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users?cursor=abc", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      id: "sync-users",
      ok: true,
      result: {
        received: {
          cursor: "abc",
        },
      },
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects workflow bodies above the server request limit", async () => {
    const workflow = {
      id: "sync-users",
      filePath: "/virtual/sync-users.ts",
      schedule: [],
      routePath: "/api/_farm/workflows/sync-users",
    };
    const run = vi.fn();
    const handler = createFarmWorkflowRequestHandler({
      workflows: [workflow],
      config: resolveWorkflowsConfig({ secret: "test-secret" }),
      server: { bodySizeLimit: 8 },
      loadModule: async () => ({ default: { run } }),
    });

    const response = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ cursor: "too-large" }),
      }),
    );

    expect(response?.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it("generates header-only Nitro workflow authentication with the server body limit", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-nitro-"));
    await fs.mkdir(path.join(root, "src", "jobs"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "jobs", "sync.mjs"),
      "export default { async run() { return { ok: true }; } };",
    );

    const prepared = await prepareFarmWorkflowsForNitro({
      root,
      workflows: { secret: "test-secret" },
      server: { bodySizeLimit: 1234 },
    });
    const handlerSource = await fs.readFile(prepared.handlerPath!, "utf8");

    expect(handlerSource).toContain("const bodySizeLimit = 1234");
    expect(handlerSource).toContain('getHeader(event, "x-farm-workflow-secret")');
    expect(handlerSource).toContain("authorization.match(/^Bearer");
    expect(handlerSource).not.toContain('searchParams.get("secret")');
  });

  it("adds scheduled workflows to Vercel crons without duplicating existing entries", () => {
    const config = applyFarmWorkflowVercelCrons(
      {
        version: 3,
        crons: [{ path: "/api/existing", schedule: "0 1 * * *" }],
      },
      [
        {
          id: "daily-cleanup",
          filePath: "/app/src/jobs/daily-cleanup.ts",
          description: "Cleanup.",
          schedule: ["0 2 * * *", "0 3 * * *"],
          routePath: "/api/_farm/workflows/daily-cleanup",
        },
        {
          id: "manual-only",
          filePath: "/app/src/jobs/manual-only.ts",
          schedule: [],
          routePath: "/api/_farm/workflows/manual-only",
        },
      ],
    );

    expect(config.crons).toEqual([
      { path: "/api/existing", schedule: "0 1 * * *" },
      { path: "/api/_farm/workflows/daily-cleanup", schedule: "0 2 * * *" },
      { path: "/api/_farm/workflows/daily-cleanup", schedule: "0 3 * * *" },
    ]);
  });
});
