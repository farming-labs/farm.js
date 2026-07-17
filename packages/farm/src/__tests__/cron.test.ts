// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyFarmCronVercelCrons,
  cronRoute,
  createFarmCronCloudflareTriggers,
  FARM_CRON_MANIFEST,
  mergeScheduledTasks,
  prepareFarmCronForNitro,
  resolveCronConfig,
} from "../cron";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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

    const wrapper = await fs.readFile(prepared.tasks["farm:cron:dailyCleanup"].handler, "utf8");
    expect(wrapper).toContain('import { defineTask, useNitroApp } from "nitro/runtime"');
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
  });

  it("fails closed when a production cron route has no secret", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "production";
    const handler = cronRoute(async () => Response.json({ deleted: 3 }));

    const response = await handler(new Request("https://example.com/api/cleanup"));
    expect(response.status).toBe(401);
  });
});
