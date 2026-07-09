import { setTimeout as delay } from "node:timers/promises";
import { logger } from "@farmjs/core";
import type { PreviewFarmOptions, PreviewTarget } from "./preview";

export interface PreviewGatewayPlan {
  provider: "farm-gateway";
  gatewayUrl: string;
  target: PreviewTarget;
  requestedName: string;
  requestedHostname: string;
  requestedPublicUrl: string;
}

export interface PreviewGatewaySession {
  id: string;
  name: string;
  token: string;
  publicUrl: string;
  expiresAt?: number;
}

export interface PreviewGatewayRequest {
  id: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | null;
  encoding?: "base64";
}

export interface PreviewGatewayResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string | null;
  encoding?: "base64";
}

export interface RunPreviewGatewayOptions {
  timeoutMs?: number;
  pollTimeoutMs?: number;
  localProbeIntervalMs?: number;
  localProbeTimeoutMs?: number;
  maxRequests?: number;
}

const DEFAULT_GATEWAY_URL = "https://preview.farming-labs.dev";
const DEFAULT_PREVIEW_DOMAIN = "preview.farming-labs.dev";
const DEFAULT_POLL_TIMEOUT_MS = 15000;
const DEFAULT_LOCAL_PROBE_INTERVAL_MS = 2000;
const DEFAULT_LOCAL_PROBE_TIMEOUT_MS = 1000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createPreviewGatewayPlan(
  target: PreviewTarget,
  options: Pick<PreviewFarmOptions, "gatewayUrl" | "name"> = {},
): PreviewGatewayPlan {
  const requestedName =
    sanitizePreviewName(options.name || process.env.FARM_PREVIEW_NAME) || randomPreviewName();
  const gatewayUrl = normalizeGatewayUrl(
    options.gatewayUrl || process.env.FARM_PREVIEW_GATEWAY_URL || DEFAULT_GATEWAY_URL,
  );
  const domain = normalizePreviewDomain(process.env.FARM_PREVIEW_DOMAIN || DEFAULT_PREVIEW_DOMAIN);
  const requestedHostname = `${requestedName}.${domain}`;

  return {
    provider: "farm-gateway",
    gatewayUrl,
    target,
    requestedName,
    requestedHostname,
    requestedPublicUrl: `https://${requestedHostname}`,
  };
}

export async function runPreviewGateway(
  plan: PreviewGatewayPlan,
  options: RunPreviewGatewayOptions = {},
): Promise<PreviewGatewaySession> {
  const session = await createGatewaySession(plan, options.timeoutMs ?? 30000);
  const controller = new AbortController();
  let handledRequests = 0;
  const localTargetWatch = watchLocalPreviewTarget(plan.target, controller, {
    intervalMs: options.localProbeIntervalMs ?? DEFAULT_LOCAL_PROBE_INTERVAL_MS,
    timeoutMs: options.localProbeTimeoutMs ?? DEFAULT_LOCAL_PROBE_TIMEOUT_MS,
  });

  const cleanup = () => controller.abort();
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  logger.success("Preview URL ready.");
  logger.info(`Public: ${session.publicUrl}`);
  logger.info("Forwarding requests until Ctrl+C.");

  try {
    while (!controller.signal.aborted) {
      const requests = await pollGatewayRequests(plan, session, {
        signal: controller.signal,
        pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      });

      await Promise.all(
        requests.map(async (request) => {
          try {
            const response = await forwardGatewayRequest(plan.target, request);
            await sendGatewayResponse(plan, session, request.id, response, controller.signal);
            handledRequests += 1;
          } catch (error) {
            if (controller.signal.aborted) return;
            logger.warn(
              `Local preview target ${plan.target.localUrl} is no longer reachable. Closing preview session.`,
            );
            controller.abort(error);
          }
        }),
      );

      if (options.maxRequests && handledRequests >= options.maxRequests) {
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);
    controller.abort();
    await localTargetWatch.catch(() => undefined);
    await closeGatewaySession(plan, session).catch(() => undefined);
  }

  return session;
}

async function watchLocalPreviewTarget(
  target: PreviewTarget,
  controller: AbortController,
  options: { intervalMs: number; timeoutMs: number },
) {
  while (!controller.signal.aborted) {
    try {
      await delay(options.intervalMs, undefined, { signal: controller.signal });
    } catch {
      return;
    }

    if (controller.signal.aborted) return;

    const reachable = await isLocalPreviewTargetReachable(target.localUrl, options.timeoutMs);
    if (!reachable && !controller.signal.aborted) {
      logger.warn(`Local preview target ${target.localUrl} is no longer reachable. Closing preview session.`);
      controller.abort(new Error("Local preview target is no longer reachable."));
      return;
    }
  }
}

async function isLocalPreviewTargetReachable(url: string, timeoutMs: number) {
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    await fetch(url, {
      method: "GET",
      signal,
    });
    return true;
  } catch {
    return false;
  }
}

export async function createGatewaySession(
  plan: PreviewGatewayPlan,
  timeoutMs: number,
): Promise<PreviewGatewaySession> {
  const response = await fetch(`${plan.gatewayUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: plan.requestedName,
      hostname: plan.requestedHostname,
      localUrl: plan.target.localUrl,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Preview gateway rejected the session (${response.status}): ${await response.text()}`);
  }

  const session = (await response.json()) as PreviewGatewaySession;
  if (!session.id || !session.token || !session.publicUrl) {
    throw new Error("Preview gateway returned an invalid session.");
  }

  return session;
}

export async function forwardGatewayRequest(
  target: PreviewTarget,
  request: PreviewGatewayRequest,
): Promise<PreviewGatewayResponse> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers || {})) {
    const normalized = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalized) || normalized.startsWith("sec-websocket-")) {
      continue;
    }
    headers.set(key, value);
  }

  headers.set("x-farm-preview", "1");

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && Boolean(request.body);
  const response = await fetch(`${target.localUrl}${request.path}`, {
    method,
    headers,
    body: hasBody ? Buffer.from(request.body || "", request.encoding === "base64" ? "base64" : "utf8") : undefined,
  });

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(normalized)) {
      responseHeaders[key] = value;
    }
  });

  return {
    status: response.status,
    headers: responseHeaders,
    body: Buffer.from(await response.arrayBuffer()).toString("base64"),
    encoding: "base64",
  };
}

async function pollGatewayRequests(
  plan: PreviewGatewayPlan,
  session: PreviewGatewaySession,
  options: { signal: AbortSignal; pollTimeoutMs: number },
) {
  try {
    const response = await fetch(
      `${plan.gatewayUrl}/api/sessions/${session.id}/requests?token=${encodeURIComponent(
        session.token,
      )}&wait=${options.pollTimeoutMs}`,
      {
        headers: {
          accept: "application/json",
        },
        signal: options.signal,
      },
    );

    if (response.status === 204) {
      return [];
    }
    if (!response.ok) {
      throw new Error(`Preview gateway poll failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as { requests?: PreviewGatewayRequest[] };
    return data.requests || [];
  } catch (error) {
    if (options.signal.aborted) return [];
    throw error;
  }
}

async function sendGatewayResponse(
  plan: PreviewGatewayPlan,
  session: PreviewGatewaySession,
  requestId: string,
  responseBody: PreviewGatewayResponse,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${plan.gatewayUrl}/api/sessions/${session.id}/responses/${requestId}?token=${encodeURIComponent(
      session.token,
    )}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(responseBody),
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(`Preview gateway response upload failed (${response.status}): ${await response.text()}`);
  }
}

async function closeGatewaySession(plan: PreviewGatewayPlan, session: PreviewGatewaySession) {
  await fetch(
    `${plan.gatewayUrl}/api/sessions/${session.id}?token=${encodeURIComponent(session.token)}`,
    {
      method: "DELETE",
    },
  );
}

export function formatGatewayPlan(plan: PreviewGatewayPlan) {
  return [
    `Gateway: ${plan.gatewayUrl}`,
    `Local:   ${plan.target.localUrl}`,
    `Public:  ${plan.requestedPublicUrl}`,
  ].join("\n");
}

function normalizeGatewayUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizePreviewDomain(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/^\.*/, "").replace(/\/*$/, "");
}

function sanitizePreviewName(value: string | undefined) {
  if (!value) return undefined;
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function randomPreviewName() {
  return `farm-${Math.random().toString(36).slice(2, 8)}`;
}
