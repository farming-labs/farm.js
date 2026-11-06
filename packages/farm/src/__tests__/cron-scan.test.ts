// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toPosixPath } from "../utils";
import { createFarmCronManifest, FARM_CRON_MANIFEST, prepareFarmCronForNitro } from "../cron";
import { mergeFarmCronJobs, resolveProjectCronJobs, scanFarmCronRouteJobs } from "../cron-scan";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

async function createProject(
  files: Record<string, string>,
  { srcDir = "src" }: { srcDir?: string } = {},
): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-cron-scan-")));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, srcDir, "app", "api", relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
  return root;
}

const scheduledRoute = `
import { createEndpoint } from "@farm.js/core/api";
import { cronRoute } from "@farm.js/core/cron";

export const GET = cronRoute(
  createEndpoint(async ({ context }) => Response.json({ input: context.cron.input })),
  {
    schedule: "0 2 * * *",
    description: "Delete expired sessions every night.",
    input: { olderThanDays: 30, dryRun: false },
    timeoutMs: 60_000,
    overlap: "skip",
  },
);
`;

describe("scanFarmCronRouteJobs", () => {
  it("extracts literal options and derives the job name and path from the file", async () => {
    const root = await createProject({ "maintenance/cleanup/route.ts": scheduledRoute });

    const jobs = await scanFarmCronRouteJobs({ root });
    expect(jobs).toEqual([
      {
        name: "maintenance/cleanup",
        schedule: ["0 2 * * *"],
        path: "/api/maintenance/cleanup",
        description: "Delete expired sessions every night.",
        input: { olderThanDays: 30, dryRun: false },
        timeoutMs: 60000,
        filePath: toPosixPath(
          path.join(root, "src", "app", "api", "maintenance", "cleanup", "route.ts"),
        ),
        enabled: true,
      },
    ]);
  });

  it("honors a custom srcDir, a schedule list, a name override, and an import alias", async () => {
    const root = await createProject(
      {
        "billing/sync/route.tsx": `
import { cronRoute as scheduled } from "@farm.js/core";
export const GET = scheduled(async () => Response.json({ ok: true }), {
  schedule: ["0 0 * * *", "0 12 * * *", "0 0 * * *"],
  name: "billing-sync",
  enabled: true,
});
`,
      },
      { srcDir: "app-src" },
    );

    const jobs = await scanFarmCronRouteJobs({ root, srcDir: "app-src" });
    expect(jobs).toEqual([
      {
        name: "billing-sync",
        schedule: ["0 0 * * *", "0 12 * * *"],
        path: "/api/billing/sync",
        filePath: toPosixPath(
          path.join(root, "app-src", "app", "api", "billing", "sync", "route.tsx"),
        ),
        enabled: true,
      },
    ]);
  });

  it("ignores cronRoute calls without a schedule, local fakes, and non-object options", async () => {
    const root = await createProject({
      "guarded/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), { secretEnv: "NIGHTLY" });
`,
      "local-fake/route.ts": `
const cronRoute = (handler: unknown, options: unknown) => handler;
export const GET = cronRoute(async () => Response.json({ ok: true }), { schedule: "0 2 * * *" });
`,
      "indirect/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
const options = { schedule: "0 2 * * *" };
export const GET = cronRoute(async () => Response.json({ ok: true }), options);
`,
    });

    await expect(scanFarmCronRouteJobs({ root })).resolves.toEqual([]);
  });

  it("rejects a computed scheduling option, naming the file and the option", async () => {
    const root = await createProject({
      "computed/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  schedule: process.env.SCHEDULE,
});
`,
    });

    await expect(scanFarmCronRouteJobs({ root })).rejects.toThrow(
      /The `schedule` option of cronRoute\(\) in .*computed.*route\.ts is not a literal\. .*write `schedule` out literally or move the job to the `cron` config/,
    );
  });

  it("rejects a template literal with expressions and a spread next to schedule", async () => {
    const templated = await createProject({
      "templated/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
const hour = 2;
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  schedule: \`0 \${hour} * * *\`,
});
`,
    });
    await expect(scanFarmCronRouteJobs({ root: templated })).rejects.toThrow(
      "The `schedule` option of cronRoute() in",
    );

    const spread = await createProject({
      "spread/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
const shared = { timeoutMs: 1000 };
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  ...shared,
  schedule: "0 2 * * *",
});
`,
    });
    await expect(scanFarmCronRouteJobs({ root: spread })).rejects.toThrow(
      /spread another object next to `schedule`.*Write every scheduling option literally/,
    );
  });

  it("rejects an invalid schedule expression, naming the route file", async () => {
    const root = await createProject({
      "bad-schedule/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  schedule: "0 2 * * * *",
});
`,
    });

    await expect(scanFarmCronRouteJobs({ root })).rejects.toThrow(
      /must use five fields.*\(from the cronRoute\(\) options in .*bad-schedule.*route\.ts\)/,
    );
  });

  it("rejects a schedule under a dynamic segment, since a scheduler cannot fill params", async () => {
    const root = await createProject({
      "jobs/[id]/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  schedule: "0 2 * * *",
});
`,
    });

    await expect(scanFarmCronRouteJobs({ root })).rejects.toThrow(
      /sits under a dynamic segment, and a scheduler cannot fill route params\. Move the schedule to a static route\./,
    );
  });

  it("rejects a duplicate job name across two route files, naming both", async () => {
    const route = (name: string) => `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  schedule: "0 2 * * *",
  name: ${JSON.stringify(name)},
});
`;
    const root = await createProject({
      "first/route.ts": route("cleanup"),
      "second/route.ts": route("cleanup"),
    });

    await expect(scanFarmCronRouteJobs({ root })).rejects.toThrow(
      /Farm cron job "cleanup" is defined twice: in .*first.*route\.ts and in .*second.*route\.ts\. Rename or remove one of them\./,
    );
  });

  it("rejects invalid literal values for name, timeoutMs, enabled, and description", async () => {
    const route = (options: string) => `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), { schedule: "0 2 * * *", ${options} });
`;
    const cases: Array<[string, RegExp]> = [
      ['name: "-bad"', /The `name` option "-bad" of cronRoute\(\) in .* is invalid\./],
      ["name: ''", /must be a non-empty string literal/],
      ["timeoutMs: -1", /must be a positive number literal in milliseconds/],
      ['enabled: "yes"', /must be `true` or `false`/],
      ["description: 4", /must be a string literal/],
    ];
    for (const [options, message] of cases) {
      const root = await createProject({ "case/route.ts": route(options) });
      await expect(scanFarmCronRouteJobs({ root })).rejects.toThrow(message);
    }
  });

  it("requires an explicit name for a schedule at the /api root", async () => {
    const root = await createProject({
      "route.ts": `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), { schedule: "0 2 * * *" });
`,
    });

    await expect(scanFarmCronRouteJobs({ root })).rejects.toThrow(
      /sits at the `\/api` root, which has no default job name\. Set the `name` option\./,
    );
  });
});

describe("resolveProjectCronJobs", () => {
  it("merges config entries and scanned route jobs into one list", async () => {
    const root = await createProject({ "maintenance/cleanup/route.ts": scheduledRoute });

    const resolved = await resolveProjectCronJobs({
      root,
      cron: { digest: { schedule: "0 9 * * *", path: "/api/digest" } },
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.jobs).toEqual([
      { name: "digest", schedule: ["0 9 * * *"], path: "/api/digest", description: undefined },
      {
        name: "maintenance/cleanup",
        schedule: ["0 2 * * *"],
        path: "/api/maintenance/cleanup",
        description: "Delete expired sessions every night.",
        input: { olderThanDays: 30, dryRun: false },
        timeoutMs: 60000,
      },
    ]);
  });

  it("drops a scanned enabled: false job, matching a disabled config entry", async () => {
    const root = await createProject({
      "paused/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  schedule: "0 2 * * *",
  enabled: false,
});
`,
    });

    const scanned = await scanFarmCronRouteJobs({ root });
    expect(scanned).toHaveLength(1);
    expect(scanned[0].enabled).toBe(false);

    const resolved = await resolveProjectCronJobs({ root, cron: {} });
    expect(resolved).toEqual({ enabled: false, secretEnv: "CRON_SECRET", jobs: [] });
  });

  it("rejects a job name defined in both the config and a route file, naming both", async () => {
    const root = await createProject({
      "cleanup/route.ts": `
import { cronRoute } from "@farm.js/core/cron";
export const GET = cronRoute(async () => Response.json({ ok: true }), {
  schedule: "0 2 * * *",
  name: "cleanup",
});
`,
    });

    await expect(
      resolveProjectCronJobs({
        root,
        cron: { cleanup: { schedule: "0 3 * * *", path: "/api/other" } },
      }),
    ).rejects.toThrow(
      /Farm cron job "cleanup" is defined twice: in the `cron` config in farm\.config\.ts and in .*cleanup.*route\.ts\. Rename or remove one of them\./,
    );
  });

  it("passes an already-resolved config through without rescanning", async () => {
    const root = await createProject({ "maintenance/cleanup/route.ts": scheduledRoute });
    const resolved = await resolveProjectCronJobs({ root, cron: {} });
    expect(resolved.jobs).toHaveLength(1);

    const again = await resolveProjectCronJobs({ root, cron: resolved });
    expect(again).toBe(resolved);
  });

  it("skips the scan entirely when cron is false", async () => {
    const root = await createProject({ "maintenance/cleanup/route.ts": scheduledRoute });
    const resolved = await resolveProjectCronJobs({ root, cron: false });
    expect(resolved).toEqual({ enabled: false, secretEnv: "CRON_SECRET", jobs: [] });
  });

  it("returns the config untouched when nothing is scheduled in routes", async () => {
    const root = await createProject({
      "plain/route.ts": `export const GET = async () => Response.json({ ok: true });`,
    });
    const resolved = await resolveProjectCronJobs({
      root,
      cron: { digest: { schedule: "0 9 * * *", path: "/api/digest" } },
    });
    expect(resolved.jobs.map((job) => job.name)).toEqual(["digest"]);
  });
});

describe("scanned jobs in build outputs", () => {
  it("writes scanned jobs with timeoutMs and input to the manifest and Nitro tasks", async () => {
    const root = await createProject({ "maintenance/cleanup/route.ts": scheduledRoute });
    const cron = await resolveProjectCronJobs({
      root,
      cron: { digest: { schedule: "0 9 * * *", path: "/api/digest" } },
    });

    const prepared = await prepareFarmCronForNitro({ root, cron });
    expect(Object.keys(prepared.tasks)).toEqual([
      "farm:cron:digest",
      "farm:cron:maintenance/cleanup",
    ]);
    expect(prepared.scheduledTasks).toEqual({
      "0 9 * * *": "farm:cron:digest",
      "0 2 * * *": "farm:cron:maintenance/cleanup",
    });

    const manifest = JSON.parse(
      await fs.readFile(path.join(root, ".farm", FARM_CRON_MANIFEST), "utf8"),
    );
    expect(manifest).toEqual({
      schemaVersion: 1,
      provider: "host",
      secretEnv: "CRON_SECRET",
      jobs: [
        { name: "digest", schedule: ["0 9 * * *"], path: "/api/digest", description: null },
        {
          name: "maintenance/cleanup",
          schedule: ["0 2 * * *"],
          path: "/api/maintenance/cleanup",
          description: "Delete expired sessions every night.",
          timeoutMs: 60000,
          input: { olderThanDays: 30, dryRun: false },
        },
      ],
    });
    expect(createFarmCronManifest(cron).jobs).toEqual(manifest.jobs);
  });
});

describe("mergeFarmCronJobs", () => {
  it("returns the same config object when the scan found nothing", () => {
    const config = { enabled: false, secretEnv: "CRON_SECRET" as const, jobs: [] };
    expect(mergeFarmCronJobs(config, [])).toBe(config);
  });
});

describe("resolveConfig integration", () => {
  it("resolves route-level schedules into the project config's cron jobs", async () => {
    const { resolveConfig } = await import("../config");
    const root = await createProject({ "maintenance/cleanup/route.ts": scheduledRoute });

    const resolved = await resolveConfig(
      { root, cron: { digest: { schedule: "0 9 * * *", path: "/api/digest" } } },
      "development",
    );
    expect(resolved.cron.enabled).toBe(true);
    expect(resolved.cron.jobs.map((job) => job.name)).toEqual(["digest", "maintenance/cleanup"]);
  });
});
