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
const originalRuntimeEnv = (globalThis as { __env__?: unknown }).__env__;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalRuntimeEnv === undefined) delete (globalThis as { __env__?: unknown }).__env__;
  else (globalThis as { __env__?: unknown }).__env__ = originalRuntimeEnv;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Farm workflows", () => {
  function unsecuredHandler(run: ReturnType<typeof vi.fn>, allowUnsecured?: boolean) {
    return createFarmWorkflowRequestHandler({
      workflows: [
        {
          id: "sync-users",
          filePath: "/virtual/sync-users.ts",
          routePath: "/api/_farm/workflows/sync-users",
        },
      ],
      config: resolveWorkflowsConfig(allowUnsecured ? { allowUnsecured: true } : undefined),
      loadModule: async () => ({ default: { run } }),
    });
  }

  it("rejects unauthenticated workflow requests in production without a secret", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CRON_SECRET;
    const run = vi.fn(async () => ({ ok: true }));
    const handler = unsecuredHandler(run);

    // Listing workflows must not be public.
    const list = await handler(new Request("https://example.com/api/_farm/workflows"));
    expect(list?.status).toBe(401);

    // Executing a workflow must not be public.
    const executed = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users", { method: "POST" }),
    );
    expect(executed?.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("serves an unsecured workflow route when explicitly opted in", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CRON_SECRET;
    const run = vi.fn(async () => ({ ok: true }));
    const handler = unsecuredHandler(run, true);

    const response = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users", { method: "POST" }),
    );
    expect(response?.status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });

  it("reads the workflow secret from runtime bindings", async () => {
    delete process.env.NODE_ENV;
    delete process.env.CRON_SECRET;
    (globalThis as { __env__?: unknown }).__env__ = { CRON_SECRET: "worker-secret" };
    const run = vi.fn(async () => ({ ok: true }));
    const handler = unsecuredHandler(run);
    const url = "https://example.com/api/_farm/workflows/sync-users";

    const unauthorized = await handler(new Request(url, { method: "POST" }));
    expect(unauthorized?.status).toBe(401);

    const authorized = await handler(
      new Request(url, { method: "POST", headers: { authorization: "Bearer worker-secret" } }),
    );
    expect(authorized?.status).toBe(200);
  });

  it("rejects workflow routes that browsers reinterpret", () => {
    for (const route of [
      "/api/../workflows",
      "/api/%2e%2e/workflows",
      "/api/%2Fworkflows",
      "/api\\workflows",
    ]) {
      expect(() => resolveWorkflowsConfig({ route })).toThrow();
    }
  });

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

  it("discovers workflows from an absolute directory outside the project", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-project-"));
    const workflowDir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-shared-"));
    const workflowPath = path.join(workflowDir, "shared-sync.mjs");
    await fs.writeFile(workflowPath, "export default { async run() { return { ok: true }; } };");

    const config = resolveWorkflowsConfig({ dir: workflowDir });
    const workflows = await discoverFarmWorkflows({ root, workflows: config });

    expect(config.dirs).toEqual([path.normalize(workflowDir)]);
    expect(workflows).toEqual([
      expect.objectContaining({
        id: "shared-sync",
        filePath: workflowPath,
      }),
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

  it("parses workflow bodies consistently by content type", async () => {
    const workflow = {
      id: "sync-users",
      filePath: "/virtual/sync-users.ts",
      routePath: "/api/_farm/workflows/sync-users",
    };
    const run = vi.fn(async (ctx) => ctx.payload);
    const handler = createFarmWorkflowRequestHandler({
      workflows: [workflow],
      config: resolveWorkflowsConfig(undefined),
      loadModule: async () => ({ default: { run } }),
    });
    const url = "https://example.com/api/_farm/workflows/sync-users";

    const textResponse = await handler(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "refresh catalog",
      }),
    );
    expect(textResponse?.status).toBe(200);
    await expect(textResponse?.json()).resolves.toMatchObject({
      result: { text: "refresh catalog" },
    });

    const vendorJsonResponse = await handler(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/farm+json; charset=utf-8" },
        body: JSON.stringify({ cursor: "next" }),
      }),
    );
    expect(vendorJsonResponse?.status).toBe(200);
    await expect(vendorJsonResponse?.json()).resolves.toMatchObject({
      result: { cursor: "next" },
    });

    const nonApplicationJsonResponse = await handler(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "text/event+json" },
        body: JSON.stringify({ cursor: "text" }),
      }),
    );
    await expect(nonApplicationJsonResponse?.json()).resolves.toMatchObject({
      result: { text: '{"cursor":"text"}' },
    });

    const malformedResponse = await handler(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{broken",
      }),
    );
    expect(malformedResponse?.status).toBe(400);
    expect(run).toHaveBeenCalledTimes(3);
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
    expect(prepared.handlerPath).not.toContain("\\");
    for (const task of Object.values(prepared.tasks)) {
      expect(task.handler).not.toContain("\\");
    }

    const handlerSource = await fs.readFile(prepared.handlerPath!, "utf8");

    expect(handlerSource).toContain("const bodySizeLimit = 1234");
    expect(handlerSource).toContain("const allowUnsecured = false");
    expect(handlerSource).toContain('getHeader(event, "x-farm-workflow-secret")');
    expect(handlerSource).toContain("authorization.match(/^Bearer");
    expect(handlerSource).not.toContain('searchParams.get("secret")');
    expect(handlerSource).toContain("function decodeRouteSegment(segment)");
    expect(handlerSource).toContain('contentType.startsWith("application/")');
    expect(handlerSource).toContain('contentType.endsWith("+json")');
    expect(handlerSource).toContain("return { text }");
    expect(handlerSource).not.toContain("decodeURIComponent(event.context.params");

    const readPayloadStart = handlerSource.indexOf("async function readPayload(event)");
    const readPayloadEnd = handlerSource.indexOf("\n\nexport default", readPayloadStart);
    expect(readPayloadStart).toBeGreaterThan(-1);
    expect(readPayloadEnd).toBeGreaterThan(readPayloadStart);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const generatedReadPayload = (await AsyncFunction(
      "readFarmRequestBody",
      "getHeader",
      "bodySizeLimit",
      "searchParamsToObject",
      `${handlerSource.slice(readPayloadStart, readPayloadEnd)}; return readPayload;`,
    )(
      async (request: Request) => new Uint8Array(await request.arrayBuffer()),
      (event: { req: Request }, name: string) => event.req.headers.get(name),
      1234,
      (searchParams: URLSearchParams) => Object.fromEntries(searchParams),
    )) as (event: { req: Request; url: URL }) => Promise<unknown>;
    const generatedTextEvent = {
      req: new Request("https://example.com/api/_farm/workflows/sync", {
        method: "POST",
        headers: { "content-type": "text/event+json" },
        body: '{"cursor":"text"}',
      }),
      url: new URL("https://example.com/api/_farm/workflows/sync"),
    };
    await expect(generatedReadPayload(generatedTextEvent)).resolves.toEqual({
      text: '{"cursor":"text"}',
    });

    const branchStart = handlerSource.indexOf("    let payload;", readPayloadEnd);
    const branchEnd = handlerSource.indexOf("    const result = await runTask", branchStart);
    expect(branchStart).toBeGreaterThan(readPayloadEnd);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const executeGeneratedPayloadBranch = AsyncFunction(
      "event",
      "readPayload",
      "createFarmRequestBodyErrorResponse",
      "json",
      `${handlerSource.slice(branchStart, branchEnd)}; return payload;`,
    ) as (
      event: { req: Request; url: URL },
      readPayload: typeof generatedReadPayload,
      createErrorResponse: (error: unknown) => Response | null,
      json: (value: unknown, status?: number) => Response,
    ) => Promise<unknown>;
    const malformedEvent = {
      req: new Request("https://example.com/api/_farm/workflows/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{broken",
      }),
      url: new URL("https://example.com/api/_farm/workflows/sync"),
    };
    const malformedResponse = await executeGeneratedPayloadBranch(
      malformedEvent,
      generatedReadPayload,
      () => null,
      (value, status = 200) => Response.json(value, { status }),
    );
    expect(malformedResponse).toBeInstanceOf(Response);
    expect((malformedResponse as Response).status).toBe(400);
  });

  it("fails generated Nitro workflow routes closed unless explicitly opted in", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-unsecured-nitro-"));
    await fs.mkdir(path.join(root, "src", "jobs"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "jobs", "sync.mjs"),
      "export default { async run() { return { ok: true }; } };",
    );

    const secured = await prepareFarmWorkflowsForNitro({
      root,
      workflows: {},
    });
    const securedSource = await fs.readFile(secured.handlerPath!, "utf8");
    expect(securedSource).toContain("const allowUnsecured = false");

    delete process.env.CRON_SECRET;
    let verifySecretStart = securedSource.indexOf("const secretEnv =");
    let verifySecretEnd = securedSource.indexOf(
      "\n\nasync function readPayload",
      verifySecretStart,
    );
    let generatedVerifySecret = Function(
      `${securedSource.slice(verifySecretStart, verifySecretEnd)}; return verifySecret;`,
    )() as (event: { req: Request }) => Response | null;
    const missingSecret = generatedVerifySecret({
      req: new Request("https://example.com/api/_farm/workflows/sync"),
    });
    expect(missingSecret?.status).toBe(401);
    await expect(missingSecret?.json()).resolves.toEqual({
      error:
        "Workflow route requires a secret. Set the CRON_SECRET environment variable, configure workflows.secret, or set workflows.allowUnsecured to true.",
    });

    const unsecured = await prepareFarmWorkflowsForNitro({
      root,
      workflows: { allowUnsecured: true },
    });
    const unsecuredSource = await fs.readFile(unsecured.handlerPath!, "utf8");
    expect(unsecuredSource).toContain("const allowUnsecured = true");

    verifySecretStart = unsecuredSource.indexOf("const secretEnv =");
    verifySecretEnd = unsecuredSource.indexOf("\n\nasync function readPayload", verifySecretStart);
    generatedVerifySecret = Function(
      `${unsecuredSource.slice(verifySecretStart, verifySecretEnd)}; return verifySecret;`,
    )() as (event: { req: Request }) => Response | null;
    expect(
      generatedVerifySecret({
        req: new Request("https://example.com/api/_farm/workflows/sync"),
      }),
    ).toBeNull();
  });

  it("verifies the secret before the id lookup in generated Nitro workflow routes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-nitro-ordering-"));
    await fs.mkdir(path.join(root, "src", "jobs"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "jobs", "sync.mjs"),
      "export default { async run() { return { ok: true }; } };",
    );

    const prepared = await prepareFarmWorkflowsForNitro({
      root,
      workflows: { secret: "test-secret" },
    });
    const handlerSource = await fs.readFile(prepared.handlerPath!, "utf8");

    // The per-id branch must call verifySecret(event) before workflowIds.has(id)
    // so an unauthenticated caller cannot distinguish existing from missing ids.
    const perIdStart = handlerSource.indexOf('.all(route + "/:id"');
    expect(perIdStart).toBeGreaterThan(-1);
    const verifySecretIndex = handlerSource.indexOf("verifySecret(event)", perIdStart);
    const hasIdIndex = handlerSource.indexOf("workflowIds.has(id)", perIdStart);
    expect(verifySecretIndex).toBeGreaterThan(perIdStart);
    expect(hasIdIndex).toBeGreaterThan(perIdStart);
    expect(verifySecretIndex).toBeLessThan(hasIdIndex);

    // Execute the pre-payload slice of the per-id branch with mocked helpers to
    // confirm the runtime ordering matches the source ordering.
    const branchStart = handlerSource.indexOf("const id = decodeRouteSegment", perIdStart);
    const branchEnd = handlerSource.indexOf("let payload;", branchStart);
    expect(branchStart).toBeGreaterThan(perIdStart);
    expect(branchEnd).toBeGreaterThan(branchStart);

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const generatedBranch = AsyncFunction(
      "event",
      "decodeRouteSegment",
      "verifySecret",
      "workflowIds",
      "json",
      `${handlerSource.slice(branchStart, branchEnd)}; return undefined;`,
    ) as (
      event: { req: Request; url: URL; context: { params?: Record<string, string> } },
      decodeRouteSegment: (segment: string) => string,
      verifySecret: (event: { req: Request }) => Response | null,
      workflowIds: { has: (id: string) => boolean },
      json: (value: unknown, status?: number) => Response,
    ) => Promise<Response | null | undefined>;

    const decode = (segment: string): string => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    };
    const json = (value: unknown, status = 200): Response => Response.json(value, { status });
    const eventFor = (id: string) => ({
      req: new Request(`https://example.com/api/_farm/workflows/${id}`, { method: "POST" }),
      url: new URL(`https://example.com/api/_farm/workflows/${id}`),
      context: { params: { id } },
    });

    // Unauthenticated request to a non-existent id: verifySecret returns 401 and
    // the id map is never consulted, so existence is not leaked.
    const has = vi.fn((_id: string) => false);
    const unauthorized = await generatedBranch(
      eventFor("unknown-job"),
      decode,
      () => json({ error: "Unauthorized workflow request." }, 401),
      { has },
      json,
    );
    expect(unauthorized?.status).toBe(401);
    expect(has).not.toHaveBeenCalled();

    // Authenticated request to a non-existent id: verifySecret passes and the
    // branch returns 404 from the existence check.
    const missing = await generatedBranch(
      eventFor("unknown-job"),
      decode,
      () => null,
      { has: () => false },
      json,
    );
    expect(missing?.status).toBe(404);
    await expect(missing?.json()).resolves.toEqual({
      error: "Workflow unknown-job was not found.",
    });

    // Authenticated request to an existing id: verifySecret passes and the
    // branch falls through to the payload/runTask section (returns undefined).
    const existing = await generatedBranch(
      eventFor("sync"),
      decode,
      () => null,
      { has: () => true },
      json,
    );
    expect(existing).toBeUndefined();
  });

  it("gives nested and hyphenated workflow ids distinct wrappers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-collide-"));
    const jobsDir = path.join(root, "src", "jobs");
    await fs.mkdir(path.join(jobsDir, "a"), { recursive: true });
    const workflowSource = "export default { async run() { return { ok: true }; } };";
    // Ids "a/b" and "a-b": safeFileName() maps both onto "a-b".
    await Promise.all([
      fs.writeFile(path.join(jobsDir, "a", "b.mjs"), workflowSource),
      fs.writeFile(path.join(jobsDir, "a-b.mjs"), workflowSource),
    ]);

    const prepared = await prepareFarmWorkflowsForNitro({ root, workflows: {} });
    const handlers = Object.values(prepared.tasks).map((task) => task.handler);

    expect(handlers).toHaveLength(2);
    // Each workflow must own its wrapper, or both tasks execute the same file.
    expect(new Set(handlers).size).toBe(2);
  });

  it("removes generated wrappers when workflows are removed or disabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-cleanup-"));
    const jobsDir = path.join(root, "src", "jobs");
    const firstWorkflow = path.join(jobsDir, "first.mjs");
    const remainingWorkflow = path.join(jobsDir, "remaining.mjs");
    const generatedDir = path.join(root, ".farm", ".nitro", "farm-workflows");
    await fs.mkdir(jobsDir, { recursive: true });
    const workflowSource = "export default { async run() { return { ok: true }; } };";
    await Promise.all([
      fs.writeFile(firstWorkflow, workflowSource),
      fs.writeFile(remainingWorkflow, workflowSource),
    ]);

    await prepareFarmWorkflowsForNitro({ root, workflows: {} });
    await expect(fs.stat(path.join(generatedDir, "first.mjs"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(generatedDir, "remaining.mjs"))).resolves.toBeDefined();

    await fs.unlink(firstWorkflow);
    await prepareFarmWorkflowsForNitro({ root, workflows: {} });
    await expect(fs.stat(path.join(generatedDir, "first.mjs"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(path.join(generatedDir, "remaining.mjs"))).resolves.toBeDefined();

    await prepareFarmWorkflowsForNitro({ root, workflows: false });
    await expect(fs.stat(generatedDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("emits only internal imports the production runtime actually exports", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-workflow-imports-"));
    await fs.mkdir(path.join(root, "src", "jobs"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "jobs", "sync.mjs"),
      "export default { async run() { return { ok: true }; } };",
    );

    const prepared = await prepareFarmWorkflowsForNitro({ root, workflows: {}, server: {} });
    const handlerSource = await fs.readFile(prepared.handlerPath!, "utf8");
    const productionRuntime = await import("../nitro/production-runtime");

    // Only a real build resolves these specifiers, so a name missing from the
    // internal entry fails `farm build` and nothing before it.
    const importBlock = handlerSource.match(
      /import\s*\{([^}]*)\}\s*from\s*"@farm\.js\/core\/internal\/production-runtime"/,
    );
    expect(importBlock).not.toBeNull();

    const imported = importBlock![1]
      .split(",")
      .map((entry) =>
        entry
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]!
          .trim(),
      )
      .filter(Boolean);

    expect(imported.length).toBeGreaterThan(0);
    for (const name of imported) {
      expect(productionRuntime).toHaveProperty(name);
    }
  });

  it("does not throw on a malformed percent-encoded workflow id and does not leak existence", async () => {
    const workflow = {
      id: "sync-users",
      filePath: "/virtual/sync-users.ts",
      description: "Sync users.",
      schedule: [],
      routePath: "/api/_farm/workflows/sync-users",
    };
    const handler = createFarmWorkflowRequestHandler({
      workflows: [workflow],
      config: resolveWorkflowsConfig({ secret: "test-secret" }),
      loadModule: async () => ({ default: { run: async () => ({}) } }),
    });

    // The id is decoded before the secret is checked, so these are reachable
    // without credentials and must not throw out of the handler. With a
    // secret configured, the secret check runs before the existence lookup, so
    // unknown and malformed ids return 401 rather than 404 and do not disclose
    // whether a workflow id is deployed.
    for (const id of ["caf%E9", "%ZZ", "a%"]) {
      const response = await handler(
        new Request(`https://example.com/api/_farm/workflows/${id}`, { method: "POST" }),
      );
      expect(response?.status).toBe(401);
    }
  });

  it("does not disclose workflow existence to unauthenticated callers", async () => {
    const workflow = {
      id: "sync-users",
      filePath: "/virtual/sync-users.ts",
      description: "Sync users.",
      schedule: [],
      routePath: "/api/_farm/workflows/sync-users",
    };
    const handler = createFarmWorkflowRequestHandler({
      workflows: [workflow],
      config: resolveWorkflowsConfig({ secret: "test-secret" }),
      loadModule: async () => ({ default: { run: async () => ({}) } }),
    });

    // Without credentials, both existing and non-existent ids must return 401
    // so an unauthenticated caller cannot distinguish them.
    for (const id of ["sync-users", "unknown-job"]) {
      const response = await handler(
        new Request(`https://example.com/api/_farm/workflows/${id}`, { method: "POST" }),
      );
      expect(response?.status).toBe(401);
    }

    // With credentials, the existing id runs and the unknown id returns 404:
    // existence is only disclosed to authenticated callers.
    const executed = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(executed?.status).toBe(200);

    const missing = await handler(
      new Request("https://example.com/api/_farm/workflows/unknown-job", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(missing?.status).toBe(404);
    await expect(missing?.json()).resolves.toEqual({
      error: 'Workflow "unknown-job" was not found.',
    });
  });

  it("keeps every value of a repeated query parameter in a GET trigger payload", async () => {
    const workflow = {
      id: "sync-users",
      filePath: "/virtual/sync-users.ts",
      description: "Sync users.",
      schedule: [],
      routePath: "/api/_farm/workflows/sync-users",
    };
    const run = vi.fn(async (ctx: any) => ({ received: ctx.payload }));
    const handler = createFarmWorkflowRequestHandler({
      workflows: [workflow],
      config: resolveWorkflowsConfig({ secret: "test-secret" }),
      loadModule: async () => ({ default: { run } }),
    });

    const response = await handler(
      new Request("https://example.com/api/_farm/workflows/sync-users?tag=a&tag=b&one=x", {
        method: "GET",
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response?.status).toBe(200);
    expect(run.mock.calls[0]?.[0].payload).toEqual({ tag: ["a", "b"], one: "x" });
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
