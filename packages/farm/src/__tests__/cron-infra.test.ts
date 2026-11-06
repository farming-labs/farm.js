// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FARM_CRON_SCHEDULER_ENV,
  registerCronJobsWithInfra,
  resolveCronEndpointOrigin,
  resolveCronSchedulerEnv,
} from "../cron-infra";
import { prepareFarmCronForNitro } from "../cron";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

const env = (values: Record<string, string | undefined>) => (name: string) => values[name];

describe("resolveCronSchedulerEnv", () => {
  it("lets FARMJS_API_KEY decide, and FARM_CRON_SCHEDULER override", () => {
    expect(resolveCronSchedulerEnv(env({})).scheduler).toBe("host");
    expect(resolveCronSchedulerEnv(env({ FARMJS_API_KEY: "farmjs_x" })).scheduler).toBe("farmjs");
    expect(
      resolveCronSchedulerEnv(env({ FARMJS_API_KEY: "farmjs_x", FARM_CRON_SCHEDULER: "host" }))
        .scheduler,
    ).toBe("host");
  });

  it("fails closed on an unknown value, and on farmjs without the key", () => {
    expect(() => resolveCronSchedulerEnv(env({ FARM_CRON_SCHEDULER: "vercel" }))).toThrow(
      /must be "host" or "farmjs"/,
    );
    expect(() => resolveCronSchedulerEnv(env({ FARM_CRON_SCHEDULER: "farmjs" }))).toThrow(
      /`FARMJS_API_KEY` is not set/,
    );
  });

  it("carries the api url, environment and project through", () => {
    const resolved = resolveCronSchedulerEnv(
      env({
        FARMJS_API_KEY: "farmjs_x",
        FARMJS_API_URL: "https://infra.example.com/",
        FARMJS_ENVIRONMENT: "staging",
        FARMJS_PROJECT_ID: "proj_1",
      }),
    );
    expect(resolved).toMatchObject({
      apiUrl: "https://infra.example.com",
      environment: "staging",
      projectId: "proj_1",
    });
  });
});

describe("resolveCronEndpointOrigin", () => {
  it("prefers FARM_SITE_URL, then the platform's deployment URL, https only", () => {
    expect(
      resolveCronEndpointOrigin(
        env({ FARM_SITE_URL: "https://app.example.com/x", VERCEL_PROJECT_PRODUCTION_URL: "o.dev" }),
      ),
    ).toBe("https://app.example.com");
    expect(
      resolveCronEndpointOrigin(env({ VERCEL_PROJECT_PRODUCTION_URL: "app.example.com" })),
    ).toBe("https://app.example.com");
    expect(resolveCronEndpointOrigin(env({ URL: "https://netlify.example.com" }))).toBe(
      "https://netlify.example.com",
    );
    expect(resolveCronEndpointOrigin(env({ FARM_SITE_URL: "http://app.example.com" }))).toBe(
      undefined,
    );
    expect(resolveCronEndpointOrigin(env({}))).toBe(undefined);
  });
});

describe("registerCronJobsWithInfra", () => {
  const infra = {
    scheduler: "farmjs" as const,
    apiKey: "farmjs_x",
    apiUrl: "https://infra.example.com",
    environment: "production",
    projectId: "proj_1",
  };
  const jobs = [
    {
      name: "cleanup",
      schedule: ["0 2 * * *"],
      path: "/api/maintenance/cleanup",
      description: "nightly",
    },
  ];

  it("PUTs the replace-all batch with the key and scope headers", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ accepted: 1 })) as unknown as typeof fetch;
    await expect(
      registerCronJobsWithInfra({ jobs, endpoint: "https://app.example.com", infra, fetchImpl }),
    ).resolves.toBe(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://infra.example.com/api/cron/jobs");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({
      authorization: "Bearer farmjs_x",
      "x-farm-environment": "production",
      "x-farm-project": "proj_1",
    });
    expect(JSON.parse(init.body)).toEqual({
      endpoint: "https://app.example.com",
      jobs: [
        {
          name: "cleanup",
          path: "/api/maintenance/cleanup",
          schedule: ["0 2 * * *"],
          description: "nightly",
        },
      ],
    });
  });

  it("fails the build with the fix when infra refuses or is unreachable", async () => {
    const refused = vi.fn(async () =>
      Response.json({ error: "forbidden" }, { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(
      registerCronJobsWithInfra({
        jobs,
        endpoint: "https://app.example.com",
        infra,
        fetchImpl: refused,
      }),
    ).rejects.toThrow(/403.*cron:jobs.*FARM_CRON_SCHEDULER=host/s);

    const down = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    await expect(
      registerCronJobsWithInfra({
        jobs,
        endpoint: "https://app.example.com",
        infra,
        fetchImpl: down,
      }),
    ).rejects.toThrow(/socket hang up.*FARM_CRON_SCHEDULER=host/s);
  });
});

describe("prepareFarmCronForNitro in infra mode", () => {
  const cron = {
    cleanup: { schedule: "0 2 * * *", path: "/api/maintenance/cleanup" },
  };

  const tempRoot = async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-cron-infra-"));
    return root;
  };

  it("registers with infra, writes the manifest, and emits no host scheduler output", async () => {
    process.env.FARMJS_API_KEY = "farmjs_x";
    process.env.FARM_SITE_URL = "https://app.example.com";
    const fetchImpl = vi.fn(async () => Response.json({ accepted: 1 }));
    vi.stubGlobal("fetch", fetchImpl);
    const root = await tempRoot();
    const prepared = await prepareFarmCronForNitro({ root, cron });
    expect(prepared.scheduler).toBe("farmjs");
    expect(prepared.tasks).toEqual({});
    expect(prepared.scheduledTasks).toEqual({});
    expect(prepared.jobs).toHaveLength(1);
    const manifest = JSON.parse(await fs.readFile(prepared.manifestPath!, "utf8"));
    expect(manifest.scheduler).toBe("farmjs");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails the build without a resolvable https origin", async () => {
    process.env.FARMJS_API_KEY = "farmjs_x";
    delete process.env.FARM_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.URL;
    const root = await tempRoot();
    await expect(prepareFarmCronForNitro({ root, cron })).rejects.toThrow(/FARM_SITE_URL/);
  });

  it("keeps the host scheduler with FARM_CRON_SCHEDULER=host, key present", async () => {
    process.env.FARMJS_API_KEY = "farmjs_x";
    process.env.FARM_CRON_SCHEDULER = "host";
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const root = await tempRoot();
    const prepared = await prepareFarmCronForNitro({ root, cron });
    expect(prepared.scheduler).toBe("host");
    expect(Object.keys(prepared.tasks)).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    const manifest = JSON.parse(await fs.readFile(prepared.manifestPath!, "utf8"));
    expect(manifest.scheduler).toBe("host");
  });

  it("registration failure rejects the prepare, so the build fails", async () => {
    process.env.FARMJS_API_KEY = "farmjs_x";
    process.env.FARM_SITE_URL = "https://app.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "nope" }, { status: 500 })),
    );
    const root = await tempRoot();
    await expect(prepareFarmCronForNitro({ root, cron })).rejects.toThrow(/500/);
  });
});
