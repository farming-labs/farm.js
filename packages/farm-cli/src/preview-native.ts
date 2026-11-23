import { setTimeout as delay } from "node:timers/promises";
import { logger } from "@farm.js/core/internal/cli-runtime";
import type { PreviewAgentExit, PreviewAgentSession } from "@farm.js/tunnel";
import type { PreviewGatewayPlan } from "./preview-gateway";

export interface NativeTunnelRuntime {
  startPreviewAgent(
    relayUrl: string,
    name: string,
    targetUrl: string,
  ): Promise<PreviewAgentSession>;
  stopPreviewAgent(sessionId: string): Promise<boolean>;
  waitPreviewAgentExit(sessionId: string): Promise<PreviewAgentExit | null>;
}

export interface RunNativePreviewTunnelOptions {
  runtime?: NativeTunnelRuntime;
  /**
   * How long a connection must have lasted before an unexpected disconnect is retried instead
   * of ending the tunnel. A relay that drops the agent sooner is treated as unavailable.
   */
  minConnectedMs?: number;
  /** Waits before each reconnection attempt. */
  reconnectDelaysMs?: readonly number[];
}

// The hosted relay runs on Vercel Functions, which end every connection after their maximum
// duration (30 minutes) and on each deploy. The relay keeps the name reserved for its owner, so
// the agent reconnects to the same public URL.
const DEFAULT_MIN_CONNECTED_MS = 30_000;
const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

export async function runNativePreviewTunnel(
  plan: PreviewGatewayPlan,
  options: RunNativePreviewTunnelOptions = {},
): Promise<PreviewAgentSession> {
  const runtime = options.runtime || (await loadNativeTunnel());
  const minConnectedMs = options.minConnectedMs ?? DEFAULT_MIN_CONNECTED_MS;
  const reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const start = () =>
    runtime.startPreviewAgent(
      createNativeRelayUrl(plan.relayUrl, plan.relayToken),
      plan.requestedName,
      plan.target.localUrl,
    );
  const session = await start();
  let current = session;
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    void runtime.stopPreviewAgent(current.sessionId);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.success("Preview URL ready.");
  logger.info(`Public: ${session.publicUrl}`);
  if (plan.dashboardUrl)
    logger.info(`Dashboard: ${plan.dashboardUrl}/${encodeURIComponent(session.sessionId)}`);
  if (plan.expiresAt) {
    logger.info(`Expires: ${new Date(plan.expiresAt).toLocaleString()}`);
  }
  logger.info("Forwarding requests through the native tunnel until Ctrl+C.");

  try {
    for (;;) {
      const connectedAt = Date.now();
      const exit = await runtime.waitPreviewAgentExit(current.sessionId);
      if (stopping) {
        return session;
      }
      if (!exit) {
        throw new Error(
          "The native preview tunnel stopped before its lifecycle could be observed.",
        );
      }
      if (isHostedPreviewExpiry(exit)) {
        return session;
      }
      await runtime.stopPreviewAgent(current.sessionId).catch(() => false);
      if (Date.now() - connectedAt < minConnectedMs) {
        throw new Error("The native preview relay disconnected unexpectedly.");
      }
      logger.warn("The preview relay closed the connection. Reconnecting...");
      const next = await reconnect(start, reconnectDelaysMs, () => stopping);
      if (!next) {
        if (stopping) return session;
        throw new Error("The native preview relay disconnected unexpectedly.");
      }
      current = next;
      if (stopping) {
        await runtime.stopPreviewAgent(current.sessionId).catch(() => false);
        return session;
      }
      if (next.publicUrl === session.publicUrl) logger.success("Reconnected.");
      else logger.warn(`Reconnected at a new URL: ${next.publicUrl}`);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await runtime.stopPreviewAgent(current.sessionId).catch(() => false);
  }
}

async function reconnect(
  start: () => Promise<PreviewAgentSession>,
  delaysMs: readonly number[],
  stopped: () => boolean,
): Promise<PreviewAgentSession | undefined> {
  for (const delayMs of delaysMs) {
    await delay(delayMs);
    if (stopped()) return undefined;
    try {
      return await start();
    } catch {
      // The relay may still be starting after a deploy; try again after the next wait.
    }
  }
  return undefined;
}

function isHostedPreviewExpiry(exit: PreviewAgentExit) {
  return exit.closeCode === 1000 && exit.closeReason === "Preview expired";
}

/**
 * The native agent takes only a relay URL, so a configured relay credential
 * travels as a query parameter. `plan.relayUrl` stays clean because the CLI
 * prints it.
 */
function createNativeRelayUrl(relayUrl: string, relayToken: string | undefined) {
  if (!relayToken) return relayUrl;
  const url = new URL(relayUrl);
  url.searchParams.set("token", relayToken);
  return url.toString();
}

async function loadNativeTunnel(): Promise<NativeTunnelRuntime> {
  try {
    return await import("@farm.js/tunnel");
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(
      `Could not load @farm.js/tunnel for this platform. Reinstall @farm.js/cli so its native platform package is restored.${reason}`,
    );
  }
}
