// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareFarmCronForNitro, resolveCronConfig } from "../cron";
import { resolveProjectCronJobs } from "../cron-scan";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-cron-config-"));
  roots.push(root);
  return root;
}
const job = { schedule: "0 2 * * *", path: "/api/cleanup" };

it("hands Infra the canonical route path that host schedulers call", async () => {
  const root = await tempRoot();
  const prepared = await prepareFarmCronForNitro({
    root,
    cron: { infra: "farmjs", jobs: { cleanup: job } },
  });
  const manifest = JSON.parse(await fs.readFile(prepared.manifestPath!, "utf8"));
  expect(manifest.jobs[0].path).toBe("/api/cleanup");
  expect(prepared.jobs[0].path).toBe("/api/cleanup");
});

it("selects Infra in config and merges route schedules with explicit jobs", async () => {
  const root = await tempRoot();
  await fs.mkdir(path.join(root, "src/app/api/digest"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src/app/api/digest/route.ts"),
    `
    import { cronRoute } from '@farm.js/core/cron';
    export const GET = cronRoute(() => Response.json({ ok: true }), { schedule: '0 9 * * *' });
  `,
  );
  const resolved = await resolveProjectCronJobs({
    root,
    cron: { infra: "farmjs", jobs: { cleanup: job } },
  });
  expect(resolved.infra).toBe("farmjs");
  expect(resolved.jobs.map((j) => j.name)).toEqual(["cleanup", "digest"]);
  expect(resolveCronConfig(resolved)).toBe(resolved);
});

it("keeps legacy job names and rejects invalid or mixed config", () => {
  expect(resolveCronConfig({ infra: job, jobs: job }).jobs.map((j) => j.name)).toEqual([
    "infra",
    "jobs",
  ]);
  expect(() => resolveCronConfig({ infra: "unknown" } as never)).toThrow(/cron.infra/);
  expect(() => resolveCronConfig({ infra: "farmjs", cleanup: job } as never)).toThrow(/cron.jobs/);
  expect(() => resolveCronConfig({ infra: "host", jobs: [] } as never)).toThrow(/cron.jobs/);
  expect(() => resolveCronConfig({ infra: "host", jobs: null } as never)).toThrow(/cron.jobs/);
});

it("never enables hosted scheduling or registers during a build just because a key exists", async () => {
  vi.stubEnv("FARMJS_API_KEY", "farmjs_test");
  vi.stubEnv("FARM_SITE_URL", "https://app.example.com");
  const fetch = vi.fn(async () => Response.json({ accepted: 1 }));
  vi.stubGlobal("fetch", fetch);
  const prepared = await prepareFarmCronForNitro({
    root: await tempRoot(),
    cron: { cleanup: job },
  });
  expect(prepared.scheduler).toBe("host");
  expect(Object.keys(prepared.tasks)).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("builds Infra output without credentials and keeps empty manifests for cleanup", async () => {
  vi.stubEnv("FARMJS_API_KEY", "");
  const fetch = vi.fn(async () => Response.json({ accepted: 1 }));
  vi.stubGlobal("fetch", fetch);
  const root = await tempRoot();
  const prepared = await prepareFarmCronForNitro({
    root,
    cron: { infra: "farmjs", jobs: { cleanup: job } },
  });
  expect(prepared.scheduler).toBe("farmjs");
  expect(prepared.tasks).toEqual({});
  expect(prepared.scheduledTasks).toEqual({});
  for (const cron of [{ infra: "farmjs" as const }, false as const]) {
    const empty = await prepareFarmCronForNitro({ root, cron });
    expect(JSON.parse(await fs.readFile(empty.manifestPath!, "utf8")).jobs).toEqual([]);
  }
  expect(fetch).not.toHaveBeenCalled();
});
