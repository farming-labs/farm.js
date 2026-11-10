// Registers farmjs.dev's route-local cron jobs with Farm.js Infra at the end of a Vercel
// production build. Vercel git deploys have no post-deploy step, and the site's FARMJS_API_KEY
// is Sensitive (only builds and functions can read it), so the build runs the sync. The jobs
// replace the endpoint's list a minute or so before the new deployment is live; a run in that
// window can 404 once and Infra retries it.
//
// Preview builds skip it. A failed sync prints a build warning and does not fail the deploy:
// the schedules stay as the last sync left them, and an Infra outage never blocks the site.
// An empty manifest is refused (DELETE_NOT_ALLOWED); clear the jobs by hand with
// `farm cron sync --url https://farmjs.dev --apply --allow-delete`.
import { spawnSync } from "node:child_process";

const URL = "https://farmjs.dev";

if (process.env.VERCEL_ENV !== "production") {
  console.log("cron sync: skipped, not a Vercel production build.");
  process.exit(0);
}

const result = spawnSync("farm", ["cron", "sync", "--url", URL, "--apply"], {
  stdio: "inherit",
  env: { ...process.env, FARMJS_ENVIRONMENT: process.env.FARMJS_ENVIRONMENT || "production" },
});

if (result.status !== 0) {
  const reason = result.error ? result.error.message : `exit ${result.status ?? result.signal}`;
  console.warn(
    `Warning: cron sync for ${URL} failed (${reason}). Infra keeps the jobs from the last sync; see the error above.`,
  );
}
