// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createEndpoint } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import {
  applyFarmCronVercelCrons,
  cronRoute,
  createFarmCronCloudflareConfig,
  createFarmCronCloudflareTriggers,
  FARM_CRON_MANIFEST,
  mergeScheduledTasks,
  prepareFarmCronForNitro,
  resolveCronConfig,
} from "../cron";

const originalEnv = { ...process.env };
const originalRuntimeEnv = (globalThis as any).__env__;

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalRuntimeEnv === undefined) delete (globalThis as any).__env__;
  else (globalThis as any).__env__ = originalRuntimeEnv;
});

describe("Farm cron", () => {
  it("resolves named routes and portable schedules", () => {
    expect(
      resolveCronConfig({
        dailyCleanup: {
          schedule: ["0 2 * * *", "0 2 * * *"],
          path: "/api/maintenance/cleanup/",
          description: "  Delete expired sessions.  ",
        },
        disabledDigest: {
          enabled: false,
          schedule: "0 9 * * *",
          path: "/api/digest",
        },
      }),
    ).toEqual({
      enabled: true,
      secretEnv: "CRON_SECRET",
      jobs: [
        {
          name: "dailyCleanup",
          schedule: ["0 2 * * *"],
          path: "/api/maintenance/cleanup",
          description: "Delete expired sessions.",
        },
      ],
    });
  });

  it("rejects schedules that are not portable five-field cron expressions", () => {
    expect(() =>
      resolveCronConfig({
        seconds: {
          schedule: "*/5 * * * * *",
          path: "/api/seconds",
        },
      }),
    ).toThrow("must use five fields");

    expect(() =>
      resolveCronConfig({
        badHour: {
          schedule: "0 24 * * *",
          path: "/api/bad-hour",
        },
      }),
    ).toThrow("invalid hour field");

    expect(() =>
      resolveCronConfig({
        sundayAlias: {
          schedule: "0 2 * * 7",
          path: "/api/sunday",
        },
      }),
    ).toThrow("invalid day of week field");

    expect(() =>
      resolveCronConfig({
        conflictingDays: {
          schedule: "0 2 1 * 1",
          path: "/api/conflicting-days",
        },
      }),
    ).toThrow("cannot constrain both day-of-month and day-of-week");

    expect(() =>
      resolveCronConfig({
        external: {
          schedule: "0 2 * * *",
          path: "https://example.com/cleanup",
        },
      }),
    ).toThrow('path must start with "/"');

    for (const path of [
      "/api/../admin",
      "/api/%2e%2e/admin",
      "/api/%2Fadmin",
      "/api\\admin",
      "/api/%0Aadmin",
    ]) {
      expect(() =>
        resolveCronConfig({
          unsafePath: {
            schedule: "0 2 * * *",
            path,
          },
        }),
      ).toThrow();
    }
  });

  it("gives case-colliding cron names distinct wrappers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-cron-case-"));
    const prepared = await prepareFarmCronForNitro({
      root,
      cron: {
        Daily: { schedule: "0 2 * * *", path: "/api/a" },
        daily: { schedule: "0 3 * * *", path: "/api/b" },
      },
    });

    const handlers = Object.values(prepared.tasks).map((task) => task.handler);
    expect(handlers).toHaveLength(2);
    // On a case-insensitive filesystem a shared name means both jobs run the
    // same wrapper, so the paths must differ by more than case.
    expect(new Set(handlers.map((handler) => handler.toLowerCase())).size).toBe(2);

    // Each wrapper still targets its own job.
    const first = await fs.readFile(prepared.tasks["farm:cron:Daily"].handler, "utf8");
    const second = await fs.readFile(prepared.tasks["farm:cron:daily"].handler, "utf8");
    expect(first).toContain('const path = "/api/a"');
    expect(second).toContain('const path = "/api/b"');
  });

  it("generates Nitro tasks, grouped schedules, and a portable manifest", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-cron-"));
    const prepared = await prepareFarmCronForNitro({
      root,
      cron: {
        dailyCleanup: {
          schedule: "0 2 * * *",
          path: "/api/maintenance/cleanup",
          description: "Delete expired sessions.",
        },
        syncPlans: {
          schedule: ["0 2 * * *", "0 * * * *"],
          path: "/api/billing/sync",
        },
      },
    });

    expect(Object.keys(prepared.tasks)).toEqual(["farm:cron:dailyCleanup", "farm:cron:syncPlans"]);
    expect(prepared.scheduledTasks).toEqual({
      "0 2 * * *": ["farm:cron:dailyCleanup", "farm:cron:syncPlans"],
      "0 * * * *": "farm:cron:syncPlans",
    });

    for (const task of Object.values(prepared.tasks)) {
      // Nitro receives these as module ids; backslash Windows paths break
      // resolution in the generated build (#395).
      expect(task.handler).not.toContain("\\");
    }

    const wrapper = await fs.readFile(prepared.tasks["farm:cron:dailyCleanup"].handler, "utf8");
    expect(wrapper).toContain('import { useNitroApp } from "nitro/app"');
    expect(wrapper).toContain('import { defineTask } from "nitro/task"');
    expect(wrapper).toContain('const path = "/api/maintenance/cleanup"');
    expect(wrapper).toContain('const secretEnv = "CRON_SECRET"');
    expect(wrapper).toContain('headers.set("authorization", "Bearer " + secret)');

    const manifest = JSON.parse(
      await fs.readFile(path.join(root, ".farm", FARM_CRON_MANIFEST), "utf8"),
    );
    expect(manifest).toEqual({
      schemaVersion: 1,
      secretEnv: "CRON_SECRET",
      jobs: [
        {
          name: "dailyCleanup",
          schedule: ["0 2 * * *"],
          path: "/api/maintenance/cleanup",
          description: "Delete expired sessions.",
        },
        {
          name: "syncPlans",
          schedule: ["0 2 * * *", "0 * * * *"],
          path: "/api/billing/sync",
          description: null,
        },
      ],
    });
  });

  it("merges cron schedules with existing Nitro tasks without duplicates", () => {
    expect(
      mergeScheduledTasks(
        { "0 2 * * *": "legacy-cleanup" },
        {
          "0 2 * * *": ["farm:cron:cleanup", "legacy-cleanup"],
          "0 * * * *": "farm:cron:sync",
        },
      ),
    ).toEqual({
      "0 2 * * *": ["legacy-cleanup", "farm:cron:cleanup"],
      "0 * * * *": "farm:cron:sync",
    });
  });

  it("creates native Vercel and Cloudflare deployment metadata", () => {
    const jobs = resolveCronConfig({
      dailyCleanup: {
        schedule: ["0 2 * * *", "0 3 * * *"],
        path: "/api/maintenance/cleanup",
      },
      nightlyDigest: {
        schedule: "0 2 * * *",
        path: "/api/digest",
      },
    }).jobs;

    expect(
      applyFarmCronVercelCrons(
        {
          version: 3,
          crons: [{ path: "/api/existing", schedule: "0 1 * * *" }],
        },
        jobs,
      ).crons,
    ).toEqual([
      { path: "/api/existing", schedule: "0 1 * * *" },
      { path: "/api/maintenance/cleanup", schedule: "0 2 * * *" },
      { path: "/api/maintenance/cleanup", schedule: "0 3 * * *" },
      { path: "/api/digest", schedule: "0 2 * * *" },
    ]);
    expect(createFarmCronCloudflareTriggers(jobs)).toEqual(["0 2 * * *", "0 3 * * *"]);
    expect(createFarmCronCloudflareConfig(jobs)).toEqual({
      deployConfig: true,
      wrangler: {
        triggers: {
          crons: ["0 2 * * *", "0 3 * * *"],
        },
      },
    });
  });

  it("protects cron routes with CRON_SECRET when it is configured", async () => {
    process.env.CRON_SECRET = "test-secret";
    const handler = cronRoute(async () => Response.json({ deleted: 3 }));

    const unauthorized = await handler(new Request("https://example.com/api/cleanup"));
    expect(unauthorized.status).toBe(401);

    const response = await handler(
      new Request("https://example.com/api/cleanup", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 3 });

    const lowercaseScheme = await handler(
      new Request("https://example.com/api/cleanup", {
        headers: { authorization: "bearer test-secret" },
      }),
    );
    expect(lowercaseScheme.status).toBe(200);

    const extraWhitespace = await handler(
      new Request("https://example.com/api/cleanup", {
        headers: { authorization: "bearer  test-secret" },
      }),
    );
    expect(extraWhitespace.status).toBe(401);
  });

  it("fails closed when a production cron route has no secret", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "production";
    const handler = cronRoute(async () => Response.json({ deleted: 3 }));

    const response = await handler(new Request("https://example.com/api/cleanup"));
    expect(response.status).toBe(401);
  });

  it("fails closed when NODE_ENV is unset and no secret is configured", async () => {
    // Plenty of container images and serverless runtimes never set NODE_ENV.
    // "Not production" must not be read as "development" for an open endpoint.
    delete process.env.CRON_SECRET;
    delete process.env.NODE_ENV;
    const handler = cronRoute(async () => Response.json({ deleted: 3 }));

    const response = await handler(new Request("https://example.com/api/cleanup"));
    expect(response.status).toBe(401);
  });

  it("fails closed for an unrecognized NODE_ENV and stays open in development", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "staging";
    const handler = cronRoute(async () => Response.json({ deleted: 3 }));
    expect((await handler(new Request("https://example.com/api/cleanup"))).status).toBe(401);

    // An explicitly declared development environment keeps working without a
    // secret, which is what `farm dev` relies on.
    process.env.NODE_ENV = "development";
    expect((await handler(new Request("https://example.com/api/cleanup"))).status).toBe(200);
  });

  it("still allows an unsecured cron route when opted in explicitly", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.NODE_ENV;
    const handler = cronRoute(async () => Response.json({ deleted: 3 }), {
      allowUnsecured: true,
    });

    const response = await handler(new Request("https://example.com/api/cleanup"));
    expect(response.status).toBe(200);
  });

  it("authorizes Worker requests from runtime bindings and fails closed without one", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.NODE_ENV;
    (globalThis as any).__env__ = { CRON_SECRET: "worker-secret" };
    const handler = cronRoute(async () => Response.json({ deleted: 3 }));

    const unauthorized = await handler(new Request("https://example.com/api/cleanup"));
    expect(unauthorized.status).toBe(401);

    const authorized = await handler(
      new Request("https://example.com/api/cleanup", {
        headers: { authorization: "Bearer worker-secret" },
      }),
    );
    expect(authorized.status).toBe(200);

    (globalThis as any).__env__ = {};
    const missingSecret = await handler(new Request("https://example.com/api/cleanup"));
    expect(missingSecret.status).toBe(401);
  });
});

describe("cronRoute around createEndpoint", () => {
  const cleanup = () =>
    createEndpoint(
      { query: z.object({ olderThanDays: z.coerce.number().int().positive() }) },
      async ({ query }) => Response.json({ olderThanDays: query.olderThanDays }),
    );

  it("guards the endpoint and keeps its parsed input", async () => {
    process.env.CRON_SECRET = "test-secret";
    const GET = cronRoute(cleanup());
    const url = "https://example.com/api/cleanup?olderThanDays=30";

    const unauthorized = await invokeAPIRouteEndpoint(GET, new Request(url));
    expect(unauthorized.status).toBe(401);

    const authorized = await invokeAPIRouteEndpoint(
      GET,
      new Request(url, { headers: { authorization: "Bearer test-secret" } }),
    );
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({ olderThanDays: 30 });
  });

  it("keeps the endpoint's validation and metadata", async () => {
    process.env.CRON_SECRET = "test-secret";
    const endpoint = cleanup();
    const GET = cronRoute(endpoint);

    const invalid = await invokeAPIRouteEndpoint(
      GET,
      new Request("https://example.com/api/cleanup?olderThanDays=soon", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(invalid.status).toBe(400);
    expect((GET as any).__types).toBe((endpoint as any).__types);
    expect((GET as any).__sourceHandler).toBe((endpoint as any).__sourceHandler);
  });

  it("keeps an endpoint's MCP and OpenAPI metadata", () => {
    const endpoint = createEndpoint(
      { mcp: true, openapi: { summary: "Clean up sessions" } },
      async () => Response.json({ ok: true }),
    );
    const GET = cronRoute(endpoint);
    expect((GET as any).__mcp).toBe(true);
    expect((GET as any).__openapi).toBe((endpoint as any).__openapi);
    expect((GET as any).__openapi).toEqual({ summary: "Clean up sessions" });
  });

  it("validates input before the secret, as endpoint middleware does, and never runs the handler", async () => {
    process.env.CRON_SECRET = "test-secret";
    let ran = false;
    const GET = cronRoute(
      createEndpoint({ query: z.object({ olderThanDays: z.coerce.number() }) }, async () => {
        ran = true;
        return Response.json({ ok: true });
      }),
    );

    const response = await invokeAPIRouteEndpoint(
      GET,
      new Request("https://example.com/api/cleanup?olderThanDays=soon"),
    );
    expect(response.status).toBe(400);
    expect(ran).toBe(false);
  });

  it("accepts a Request-like object, as a Node server can pass", async () => {
    process.env.CRON_SECRET = "test-secret";
    const GET = cronRoute(createEndpoint(async () => Response.json({ ok: true }))) as any;
    const call = (headers: Record<string, string>) =>
      GET.__farmInvoke({ request: { headers: new Headers(headers) }, context: {} });

    expect((await call({ authorization: "Bearer test-secret" })).handlerExecuted).toBe(true);
    const denied = await call({});
    expect(denied.handlerExecuted).toBe(false);
    expect(denied.result.status).toBe(401);
  });

  it("guards an imported route's copy and leaves the original route unchanged", async () => {
    process.env.CRON_SECRET = "test-secret";
    // An existing route module's export, imported into a cron-only route.
    const existing = createEndpoint(async () => Response.json({ ok: true }));
    const cronCopy = cronRoute(existing);
    const request = () => new Request("https://example.com/api/cleanup");

    expect((await invokeAPIRouteEndpoint(cronCopy, request())).status).toBe(401);
    expect((await invokeAPIRouteEndpoint(existing, request())).status).toBe(200);
    expect(cronCopy).not.toBe(existing);
  });

  it("fails closed for an endpoint when production has no secret", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "production";
    let ran = false;
    const GET = cronRoute(
      createEndpoint(async () => {
        ran = true;
        return Response.json({ ok: true });
      }),
    );

    const response = await invokeAPIRouteEndpoint(
      GET,
      new Request("https://example.com/api/cleanup"),
    );
    expect(response.status).toBe(401);
    expect(ran).toBe(false);
  });
});

describe("cronRoute schedule options", () => {
  const authorized = (
    url = "https://example.com/api/cleanup",
    headers: Record<string, string> = {},
  ) => new Request(url, { headers: { authorization: "Bearer test-secret", ...headers } });

  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  // A macrotask fence: the in-flight release runs in a microtask after the gated handler
  // settles, so the next call must start after the queue drains. Not a duration-based sleep.
  const microtasksDrained = () => new Promise<void>((resolve) => setImmediate(resolve));

  it("delivers context.cron with the scheduler headers, the literal input, and a signal", async () => {
    process.env.CRON_SECRET = "test-secret";
    let seen: any;
    const GET = cronRoute(
      createEndpoint(async ({ context }: any) => {
        seen = context.cron;
        return Response.json({ ok: true });
      }),
      { schedule: "0 2 * * *", input: { olderThanDays: 30 } },
    );

    const response = await invokeAPIRouteEndpoint(
      GET,
      authorized("https://example.com/api/cleanup", {
        "x-farm-cron-name": "cleanup",
        "x-farm-cron-scheduled-at": "1793544000000",
      }),
    );
    expect(response.status).toBe(200);
    expect(seen.name).toBe("cleanup");
    expect(seen.scheduledAt).toEqual(new Date(1793544000000));
    expect(seen.input).toEqual({ olderThanDays: 30 });
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.signal.aborted).toBe(false);
  });

  it("leaves name and scheduledAt undefined for a direct platform call", async () => {
    process.env.CRON_SECRET = "test-secret";
    let seen: any;
    const GET = cronRoute(
      createEndpoint(async ({ context }: any) => {
        seen = context.cron;
        return Response.json({ ok: true });
      }),
      { schedule: "0 2 * * *" },
    );

    await invokeAPIRouteEndpoint(
      GET,
      authorized("https://example.com/api/cleanup", { "x-farm-cron-scheduled-at": "soon" }),
    );
    expect(seen.name).toBeUndefined();
    // A header that is not a millisecond epoch reads as absent, never as an Invalid Date.
    expect(seen.scheduledAt).toBeUndefined();
    expect(seen.input).toBeUndefined();
  });

  it("preserves middleware context next to context.cron", async () => {
    process.env.CRON_SECRET = "test-secret";
    let seen: any;
    const GET = cronRoute(
      createEndpoint({ middleware: [() => ({ tenant: "acme" })] }, async ({ context }: any) => {
        seen = context;
        return Response.json({ ok: true });
      }),
      { schedule: "0 2 * * *", input: [1, 2] },
    );

    const response = await invokeAPIRouteEndpoint(GET, authorized());
    expect(response.status).toBe(200);
    expect(seen.tenant).toBe("acme");
    expect(seen.cron.input).toEqual([1, 2]);
  });

  it("answers 504 and aborts context.cron.signal when the handler outlives timeoutMs", async () => {
    process.env.CRON_SECRET = "test-secret";
    const gate = deferred<Response>();
    let signal: AbortSignal | undefined;
    const GET = cronRoute(
      createEndpoint(async ({ context }: any) => {
        signal = context.cron.signal;
        return gate.promise;
      }),
      { schedule: "0 2 * * *", timeoutMs: 20 },
    );

    const response = await invokeAPIRouteEndpoint(GET, authorized());
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      error:
        "The cron handler did not finish within its `timeoutMs` of 20 milliseconds. Raise `timeoutMs` or make the handler finish sooner.",
    });
    expect(signal?.aborted).toBe(true);
    // Let the abandoned handler settle so nothing leaks into other tests.
    gate.resolve(Response.json({ late: true }));
  });

  it("keeps the handler's own result when it finishes before timeoutMs", async () => {
    process.env.CRON_SECRET = "test-secret";
    const GET = cronRoute(
      createEndpoint(async () => Response.json({ ok: true })),
      { schedule: "0 2 * * *", timeoutMs: 5_000 },
    );

    const response = await invokeAPIRouteEndpoint(GET, authorized());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("skips an overlapping run with 409 and allows the next one after completion", async () => {
    process.env.CRON_SECRET = "test-secret";
    const gate = deferred<Response>();
    let runs = 0;
    const GET = cronRoute(
      createEndpoint(async () => {
        runs += 1;
        return runs === 1 ? gate.promise : Response.json({ ok: true });
      }),
      { schedule: "0 2 * * *", name: "overlap-endpoint", overlap: "skip" },
    );

    const first = invokeAPIRouteEndpoint(GET, authorized());
    // The first run is parked on the gate; the overlapping call must not run the handler.
    const skipped = await invokeAPIRouteEndpoint(GET, authorized());
    expect(skipped.status).toBe(409);
    await expect(skipped.json()).resolves.toEqual({ skipped: true });
    expect(runs).toBe(1);

    gate.resolve(Response.json({ ok: true }));
    expect((await first).status).toBe(200);
    await microtasksDrained();

    const after = await invokeAPIRouteEndpoint(GET, authorized());
    expect(after.status).toBe(200);
    expect(runs).toBe(2);
  });

  it("holds the overlap mark until a timed-out handler settles", async () => {
    process.env.CRON_SECRET = "test-secret";
    const gate = deferred<Response>();
    let runs = 0;
    const GET = cronRoute(
      createEndpoint(async () => {
        runs += 1;
        return runs === 1 ? gate.promise : Response.json({ ok: true });
      }),
      { schedule: "0 2 * * *", name: "overlap-timeout", overlap: "skip", timeoutMs: 20 },
    );

    const timedOut = await invokeAPIRouteEndpoint(GET, authorized());
    expect(timedOut.status).toBe(504);
    // The abandoned first run is still going, so the job still counts as in flight.
    const skipped = await invokeAPIRouteEndpoint(GET, authorized());
    expect(skipped.status).toBe(409);
    expect(runs).toBe(1);

    gate.resolve(Response.json({ late: true }));
    await microtasksDrained();
    const after = await invokeAPIRouteEndpoint(GET, authorized());
    expect(after.status).toBe(200);
    expect(runs).toBe(2);
  });

  it("applies timeoutMs and overlap to a plain handler", async () => {
    process.env.CRON_SECRET = "test-secret";
    const gate = deferred<Response>();
    let runs = 0;
    const handler = cronRoute(
      async () => {
        runs += 1;
        return runs === 1 ? gate.promise : Response.json({ ok: true });
      },
      { schedule: "0 2 * * *", name: "overlap-plain", overlap: "skip", timeoutMs: 20 },
    );

    const timedOut = (await handler(authorized())) as Response;
    expect(timedOut.status).toBe(504);
    await expect(timedOut.json()).resolves.toEqual({
      error:
        "The cron handler did not finish within its `timeoutMs` of 20 milliseconds. Raise `timeoutMs` or make the handler finish sooner.",
    });

    const skipped = (await handler(authorized())) as Response;
    expect(skipped.status).toBe(409);
    await expect(skipped.json()).resolves.toEqual({ skipped: true });
    expect(runs).toBe(1);

    gate.resolve(Response.json({ late: true }));
    await microtasksDrained();
    const after = (await handler(authorized())) as Response;
    expect(after.status).toBe(200);
    expect(runs).toBe(2);
  });

  it("does not share the in-flight mark between unnamed routes", async () => {
    process.env.CRON_SECRET = "test-secret";
    const gate = deferred<Response>();
    const first = cronRoute(async () => gate.promise, { overlap: "skip" });
    const second = cronRoute(async () => Response.json({ ok: true }), { overlap: "skip" });

    const firstPending = first(authorized());
    const other = (await second(authorized())) as Response;
    expect(other.status).toBe(200);

    gate.resolve(Response.json({ ok: true }));
    expect(((await firstPending) as Response).status).toBe(200);
  });

  it("leaves auth and the handler untouched when enabled is false", async () => {
    process.env.CRON_SECRET = "test-secret";
    const GET = cronRoute(
      createEndpoint(async () => Response.json({ ok: true })),
      { schedule: "0 2 * * *", enabled: false },
    );

    const unauthorized = await invokeAPIRouteEndpoint(
      GET,
      new Request("https://example.com/api/cleanup"),
    );
    expect(unauthorized.status).toBe(401);
    expect((await invokeAPIRouteEndpoint(GET, authorized())).status).toBe(200);
  });

  it("keeps the secret options working next to schedule options", async () => {
    delete process.env.CRON_SECRET;
    process.env.NIGHTLY_SECRET = "nightly";
    const GET = cronRoute(
      createEndpoint(async () => Response.json({ ok: true })),
      { schedule: "0 2 * * *", secretEnv: "NIGHTLY_SECRET", timeoutMs: 5_000 },
    );

    const denied = await invokeAPIRouteEndpoint(GET, new Request("https://example.com/api/x"));
    expect(denied.status).toBe(401);
    const ok = await invokeAPIRouteEndpoint(
      GET,
      new Request("https://example.com/api/x", { headers: { authorization: "Bearer nightly" } }),
    );
    expect(ok.status).toBe(200);
  });

  it("rejects an invalid timeoutMs or overlap when the route is defined", () => {
    expect(() => cronRoute(async () => Response.json({ ok: true }), { timeoutMs: 0 })).toThrow(
      "Farm cron `timeoutMs` must be a positive number of milliseconds; received 0. Remove the option or set a positive number.",
    );
    expect(() =>
      cronRoute(async () => Response.json({ ok: true }), { timeoutMs: Number.NaN }),
    ).toThrow("must be a positive number of milliseconds");
    expect(() =>
      cronRoute(async () => Response.json({ ok: true }), { overlap: "queue" as never }),
    ).toThrow(
      'Farm cron `overlap` only supports "skip"; received "queue". Remove the option to allow overlapping runs.',
    );
  });
});
