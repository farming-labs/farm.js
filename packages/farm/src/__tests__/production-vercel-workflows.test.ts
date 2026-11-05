// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

// Nitro's Vercel preset turns `scheduledTasks` into a `/_vercel/cron` route that only checks
// Authorization when CRON_SECRET is set, and otherwise runs every task for the schedule named
// in the client-supplied `x-vercel-cron-schedule` header. Farm already writes its own Vercel
// crons to the secret-checked workflow route, so scheduled workflows must only run there.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

// Loads the built function in a plain Node process, as Vercel does, so a bare import the
// bundle failed to resolve breaks here instead of being resolved by the test runner.
const PROBE = `
const { default: handler } = await import(new URL("./index.mjs", process.argv[2]).href);
const runs = () => globalThis.__farmNightlyRuns ?? 0;
const results = [];
for (const [secret, pathname, headers] of JSON.parse(process.argv[3])) {
  if (secret) process.env.CRON_SECRET = secret;
  else delete process.env.CRON_SECRET;
  const before = runs();
  const response = await handler.fetch(new Request("https://farm.test" + pathname, { headers }));
  await response.text();
  results.push({ pathname, status: response.status, ran: runs() > before });
}
console.log(JSON.stringify(results));
process.exit(0);
`;

describe("Vercel scheduled workflows", () => {
  it("runs them only through Farm's secret-checked workflow route", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-vercel-workflows-"));
    try {
      // Only Farm and React are app dependencies, as in a pnpm app: nitro and h3 are not
      // resolvable from the app root.
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      for (const name of ["react", "react-dom"]) {
        await fs.symlink(
          await fs.realpath(path.join(packageRoot, "node_modules", name)),
          path.join(root, "node_modules", name),
          "junction",
        );
      }
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
      await fs.mkdir(path.join(root, "src", "workflows"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "layout.tsx"),
        "export default function Layout({ children }) { return <main>{children}</main>; }",
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        "export default function Page() { return <p>home</p>; }",
      );
      await fs.writeFile(
        path.join(root, "src", "workflows", "nightly.ts"),
        [
          'import { defineWorkflow } from "@farm.js/core/workflows";',
          "export default defineWorkflow({",
          '  schedule: "0 3 * * *",',
          "  async run() {",
          "    globalThis.__farmNightlyRuns = (globalThis.__farmNightlyRuns ?? 0) + 1;",
          "    return { ran: true };",
          "  },",
          "});",
        ].join("\n"),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
          cron: { cleanup: { schedule: "0 2 * * *", path: "/api/cleanup" } },
        },
        "production",
      );
      await build(config, { root, preset: "vercel" });

      const outputDir = path.resolve(root, config.deploy.outputDir);
      const vercelConfig = JSON.parse(
        await fs.readFile(path.join(outputDir, "config.json"), "utf8"),
      );
      // One cron per schedule, each at a Farm route that checks the secret.
      expect(vercelConfig.crons).toEqual([
        { path: "/api/_farm/workflows/nightly", schedule: "0 3 * * *" },
        { path: "/api/cleanup", schedule: "0 2 * * *" },
      ]);
      expect(JSON.stringify(vercelConfig.routes)).not.toContain("/_vercel/cron");

      const forged = { "x-vercel-cron-schedule": "0 3 * * *" };
      const bearer = { authorization: "Bearer s3cret" };
      const probe = path.join(root, "probe.mjs");
      await fs.writeFile(probe, PROBE);
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          probe,
          pathToFileURL(path.join(outputDir, "functions", "__nitro.func") + path.sep).href,
          JSON.stringify([
            [null, "/api/_farm/workflows/nightly", {}],
            [null, "/_vercel/cron", forged],
            ["s3cret", "/_vercel/cron", { ...forged, ...bearer }],
            ["s3cret", "/api/_farm/workflows/nightly", bearer],
          ]),
        ],
        { env: { ...process.env, NODE_ENV: "production", CRON_SECRET: "" } },
      );
      const [unsecured, forgedCron, signedCron, scheduled] = JSON.parse(stdout.trim());
      // Without CRON_SECRET, neither Farm's route nor a forged Vercel cron call runs it.
      expect(unsecured).toMatchObject({ status: 401, ran: false });
      expect(forgedCron).toMatchObject({ ran: false });
      expect(forgedCron.status).not.toBe(200);
      // With a secret, the workflow is not scheduled a second time through Nitro's route.
      expect(signedCron).toMatchObject({ ran: false });
      // The route Vercel's cron calls still runs the task.
      expect(scheduled).toMatchObject({ status: 200, ran: true });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
