import { cronRoute } from "@farm.js/core/cron";

// Farm.js Infra runs this schedule (`cron.provider: "farmjs"`), not Vercel Cron. Each run is a
// signed GET; the answer and its duration show on the Infra cron dashboard.
export const GET = cronRoute(
  (request) =>
    Response.json(
      { ok: true, scheduledAt: request.headers.get("x-farm-cron-scheduled-at") },
      { headers: { "cache-control": "no-store" } },
    ),
  {
    name: "heartbeat",
    schedule: "*/15 * * * *",
    description: "Answers 200 so farmjs.dev's run history shows Farm.js Infra's clock arriving.",
    timeoutMs: 10_000,
  },
);
