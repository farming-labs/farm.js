import { logger } from "@farm.js/core";
import type { PreviewAgentSession } from "@farm.js/tunnel";
import type { PreviewGatewayPlan } from "./preview-gateway";

export interface NativeTunnelRuntime {
  startPreviewAgent(
    relayUrl: string,
    name: string,
    targetUrl: string,
  ): Promise<PreviewAgentSession>;
  stopPreviewAgent(sessionId: string): Promise<boolean>;
  waitPreviewAgent(sessionId: string): Promise<boolean>;
}

export interface RunNativePreviewTunnelOptions {
  runtime?: NativeTunnelRuntime;
}

export async function runNativePreviewTunnel(
  plan: PreviewGatewayPlan,
  options: RunNativePreviewTunnelOptions = {},
): Promise<PreviewAgentSession> {
  const runtime = options.runtime || (await loadNativeTunnel());
  const session = await runtime.startPreviewAgent(
    plan.relayUrl,
    plan.requestedName,
    plan.target.localUrl,
  );
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    void runtime.stopPreviewAgent(session.sessionId);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.success("Preview URL ready.");
  logger.info(`Public: ${session.publicUrl}`);
  logger.info("Forwarding requests through the native tunnel until Ctrl+C.");

  try {
    const waited = await runtime.waitPreviewAgent(session.sessionId);
    if (!waited) {
      throw new Error("The native preview tunnel stopped before its lifecycle could be observed.");
    }
    return session;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await runtime.stopPreviewAgent(session.sessionId).catch(() => false);
  }
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
