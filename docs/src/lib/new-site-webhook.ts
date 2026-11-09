import { createHmac } from "node:crypto";

export const FARM_NEW_SITE_WEBHOOK_EVENT = "farm.site.created" as const;

const REQUEST_TIMEOUT_MS = 5_000;
// Waits before the second and third attempts. A delivery that still fails is logged and dropped:
// the site stays listed on /telemetry.
const RETRY_DELAYS_MS = [1_000, 3_000];

export interface NewFarmSite {
  url: string;
  packageVersion: string;
  renderer: string;
  deployTarget: string;
  firstSeenAt: Date;
}

interface NotifyNewFarmSiteOptions {
  url?: string;
  secret?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * POSTs `farm.site.created` to `FARM_NEW_SITE_WEBHOOK_URL` (HTTPS) when farmjs.dev verifies a
 * production site it has not seen before. Without the variable nothing is sent.
 *
 * The JSON body has `event`, `site` and a one-line `text`, which Slack-style incoming webhooks
 * post as is. With `FARM_NEW_SITE_WEBHOOK_SECRET`, each request also carries `x-farm-timestamp`
 * (Unix seconds) and `x-farm-signature: sha256=<hex>`, the HMAC-SHA256 of `<timestamp>.<body>`.
 *
 * Network errors, 429 and 5xx are retried twice; other responses are not. Returns whether the
 * webhook accepted the event. It never throws, so it cannot fail the telemetry request.
 */
export async function notifyNewFarmSite(
  site: NewFarmSite,
  options: NotifyNewFarmSiteOptions = {},
): Promise<boolean> {
  const target = options.url ?? process.env.FARM_NEW_SITE_WEBHOOK_URL;
  if (!target) return false;
  let endpoint: URL;
  try {
    endpoint = new URL(target);
  } catch {
    console.error("[farmjs.telemetry.new-site-webhook]", "FARM_NEW_SITE_WEBHOOK_URL is not a URL");
    return false;
  }
  if (endpoint.protocol !== "https:") {
    console.error(
      "[farmjs.telemetry.new-site-webhook]",
      "FARM_NEW_SITE_WEBHOOK_URL must use https",
    );
    return false;
  }

  const body = JSON.stringify({
    event: FARM_NEW_SITE_WEBHOOK_EVENT,
    site: {
      url: site.url,
      packageVersion: site.packageVersion,
      renderer: site.renderer,
      deployTarget: site.deployTarget,
      firstSeenAt: site.firstSeenAt.toISOString(),
    },
    text: `New Farm.js site: ${site.url} (v${site.packageVersion}, ${site.renderer}, ${site.deployTarget})`,
  });
  const secret = options.secret ?? process.env.FARM_NEW_SITE_WEBHOOK_SECRET;
  const send = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "farmjs.dev telemetry",
      "x-farm-event": FARM_NEW_SITE_WEBHOOK_EVENT,
    };
    if (secret) {
      const timestamp = String(Math.floor((options.now?.() ?? Date.now()) / 1_000));
      headers["x-farm-timestamp"] = timestamp;
      headers["x-farm-signature"] =
        `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
    }

    let retryable: boolean;
    let reason: string;
    try {
      const response = await send(endpoint, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => {});
      if (response.ok) return true;
      retryable = response.status === 429 || response.status >= 500;
      reason = `HTTP ${response.status}`;
    } catch (error) {
      retryable = true;
      reason = error instanceof Error ? error.message : String(error);
    }

    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      // The site URL is public; the webhook URL can hold a token, so it is never logged.
      console.error("[farmjs.telemetry.new-site-webhook]", `${site.url}: ${reason}`);
      return false;
    }
    await sleep(RETRY_DELAYS_MS[attempt]!);
  }
}
