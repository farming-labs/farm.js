import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig, logger } from "@farmjs/core";
import {
  createPreviewGatewayPlan,
  formatGatewayPlan,
  runPreviewGateway,
  type PreviewGatewayPlan,
  type PreviewGatewaySession,
} from "./preview-gateway";

export interface PreviewFarmOptions {
  root?: string;
  configPath?: string;
  port?: number | string;
  host?: string;
  url?: string;
  gatewayUrl?: string;
  name?: string;
  dryRun?: boolean;
  noProbe?: boolean;
  timeoutMs?: number;
  provider?: "farm" | "local";
}

export interface PreviewTarget {
  localUrl: string;
  host: string;
  port: number;
  source: "url" | "port" | "config" | "detected";
}

export interface PreviewTunnelPlan {
  command: string;
  args: string[];
  shell?: boolean;
  target: PreviewTarget;
  requestedName: string;
  requestedHostname: string;
}

export interface PreviewFarmResult {
  target: PreviewTarget;
  plan: PreviewTunnelPlan | PreviewGatewayPlan;
  publicUrl?: string;
  session?: PreviewGatewaySession;
}

const DEFAULT_PREVIEW_PORTS = [3000, 4319, 5173, 4173, 8080];
const PREVIEW_URL_PATTERN = /https:\/\/[^\s"')\]}]+/g;

export async function previewFarm(options: PreviewFarmOptions = {}): Promise<PreviewFarmResult> {
  const target = await resolvePreviewTarget(options);

  logger.info("Creating public preview for the running app...");
  logger.info(`Local:  ${target.localUrl}`);

  if (shouldUseManagedGateway(options)) {
    const plan = createPreviewGatewayPlan(target, options);

    if (options.dryRun) {
      logger.info(formatGatewayPlan(plan));
      logger.success("Preview gateway dry run completed.");
      return { target, plan };
    }

    logger.info(`Gateway: ${plan.gatewayUrl}`);
    logger.info("Opening Farm preview gateway session...");
    const session = await runPreviewGateway(plan, {
      timeoutMs: options.timeoutMs,
    });
    return { target, plan, publicUrl: session.publicUrl, session };
  }

  const plan = createPreviewTunnelPlan(target, options);

  if (options.dryRun) {
    logger.info(`Command: ${formatCommand(plan)}`);
    logger.success("Preview tunnel dry run completed.");
    return { target, plan };
  }

  logger.info("Opening public tunnel...");
  const publicUrl = await runPreviewTunnel(plan, options.timeoutMs ?? 30000);
  return { target, plan, publicUrl };
}

function shouldUseManagedGateway(options: PreviewFarmOptions) {
  if (options.provider === "farm" || process.env.FARM_PREVIEW_PROVIDER === "farm") {
    return true;
  }
  if (options.provider === "local" || process.env.FARM_PREVIEW_PROVIDER === "local") {
    return false;
  }
  return !process.env.FARM_PREVIEW_TUNNEL_COMMAND;
}

export async function resolvePreviewTarget(
  options: PreviewFarmOptions = {},
): Promise<PreviewTarget> {
  if (options.url) {
    const parsed = new URL(options.url);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!Number.isFinite(port)) {
      throw new Error(`Could not resolve a port from ${options.url}.`);
    }
    return {
      localUrl: normalizeLocalUrl(options.url),
      host: parsed.hostname,
      port,
      source: "url",
    };
  }

  const root = options.root || process.cwd();
  const host = options.host || process.env.FARM_PREVIEW_HOST || "localhost";
  const explicitPort = normalizePort(options.port || process.env.FARM_PREVIEW_PORT);
  const configPort = explicitPort ? undefined : await readConfigPort(root, options.configPath);
  const candidates = uniqueNumbers([
    explicitPort,
    normalizePort(process.env.FARM_PORT),
    normalizePort(process.env.PORT),
    configPort,
    ...DEFAULT_PREVIEW_PORTS,
  ]);

  if (!candidates.length) {
    throw new Error("No preview port candidates were available.");
  }

  if (options.noProbe && explicitPort) {
    return {
      localUrl: createLocalUrl(host, explicitPort),
      host,
      port: explicitPort,
      source: "port",
    };
  }

  const timeoutMs = options.timeoutMs ?? 1500;
  for (const port of candidates) {
    const localUrl = createLocalUrl(host, port);
    if (await isReachable(localUrl, timeoutMs)) {
      return {
        localUrl,
        host,
        port,
        source: explicitPort ? "port" : configPort === port ? "config" : "detected",
      };
    }
  }

  const hint = explicitPort ? createLocalUrl(host, explicitPort) : candidates.map((port) => port).join(", ");
  throw new Error(
    `No running Farm app was found (${hint}). Start "farm dev" first, or pass --port/--url to the running app.`,
  );
}

export function createPreviewTunnelPlan(
  target: PreviewTarget,
  options: Pick<PreviewFarmOptions, "name"> = {},
): PreviewTunnelPlan {
  const requestedName = sanitizePreviewName(options.name || process.env.FARM_PREVIEW_NAME) || randomPreviewName();
  const domain = normalizePreviewDomain(process.env.FARM_PREVIEW_DOMAIN || "preview.farming-labs.dev");
  const requestedHostname = `${requestedName}.${domain}`;
  const template = process.env.FARM_PREVIEW_TUNNEL_COMMAND;

  if (template) {
    return {
      command: expandTunnelTemplate(template, target, requestedName, requestedHostname),
      args: [],
      shell: true,
      target,
      requestedName,
      requestedHostname,
    };
  }

  if (commandExists("cloudflared")) {
    return {
      command: "cloudflared",
      args: ["tunnel", "--url", target.localUrl],
      target,
      requestedName,
      requestedHostname,
    };
  }

  if (commandExists("npx")) {
    return {
      command: "npx",
      args: [
        "--yes",
        "localtunnel",
        "--port",
        String(target.port),
        "--local-host",
        target.host,
        "--subdomain",
        requestedName,
      ],
      target,
      requestedName,
      requestedHostname,
    };
  }

  throw new Error(
    "No preview tunnel command is available. Install cloudflared, ensure npx is available, or set FARM_PREVIEW_TUNNEL_COMMAND.",
  );
}

export function parsePreviewPublicUrl(output: string, preferredHostname?: string): string | undefined {
  const matches = output.match(PREVIEW_URL_PATTERN) || [];
  const urls = matches.filter((value) => {
    try {
      const url = new URL(value);
      return Boolean(url.hostname);
    } catch {
      return false;
    }
  });

  if (preferredHostname) {
    const preferred = urls.find((value) => new URL(value).hostname === preferredHostname);
    if (preferred) return preferred;
  }

  return (
    urls.find((value) => {
      const host = new URL(value).hostname;
      return (
        host.endsWith(".trycloudflare.com") ||
        host.endsWith(".loca.lt") ||
        host.endsWith(".localtunnel.me") ||
        host.endsWith(".ngrok.app") ||
        host.endsWith(".ngrok-free.app") ||
        host.endsWith(".ngrok.dev") ||
        host.endsWith(".ngrok.io") ||
        host.endsWith(".preview.farming-labs.dev")
      );
    }) || urls[0]
  );
}

async function runPreviewTunnel(plan: PreviewTunnelPlan, timeoutMs: number): Promise<string> {
  const child = spawn(plan.command, plan.args, {
    env: {
      ...process.env,
      FARM_PREVIEW_LOCAL_URL: plan.target.localUrl,
      FARM_PREVIEW_NAME: plan.requestedName,
      FARM_PREVIEW_HOSTNAME: plan.requestedHostname,
    },
    shell: plan.shell,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let publicUrl: string | undefined;
  let settled = false;

  const cleanup = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  try {
    publicUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for the preview URL."));
      }, timeoutMs);

      const handleChunk = (chunk: Buffer) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
        const nextUrl = parsePreviewPublicUrl(output, plan.requestedHostname);
        if (nextUrl && !settled) {
          settled = true;
          clearTimeout(timer);
          logger.success("Preview URL ready.");
          logger.info(`Public: ${nextUrl}`);
          logger.info("Forwarding requests until Ctrl+C.");
          resolve(nextUrl);
        }
      };

      child.stdout?.on("data", handleChunk);
      child.stderr?.on("data", handleChunk);
      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
      child.on("exit", (code, signal) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              `Preview tunnel exited before returning a URL (${signal || `exit code ${code ?? 0}`}).`,
            ),
          );
        }
      });
    });

    await waitForTunnelExit(child);
    return publicUrl;
  } finally {
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);
  }
}

function waitForTunnelExit(child: ChildProcess) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

async function isReachable(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    await delay(0);
  }
}

async function readConfigPort(root: string, configPath?: string) {
  try {
    const config = await loadConfig(root, configPath, "development");
    const vite = config?.vite;
    if (!vite || typeof vite === "function") return undefined;
    return normalizePort(vite.server?.port);
  } catch {
    return undefined;
  }
}

function commandExists(command: string) {
  const result = spawnSync(command, ["--version"], {
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function expandTunnelTemplate(
  template: string,
  target: PreviewTarget,
  requestedName: string,
  requestedHostname: string,
) {
  return template
    .replaceAll("{url}", shellQuote(target.localUrl))
    .replaceAll("{port}", shellQuote(String(target.port)))
    .replaceAll("{host}", shellQuote(target.host))
    .replaceAll("{name}", shellQuote(requestedName))
    .replaceAll("{hostname}", shellQuote(requestedHostname));
}

function shellQuote(value: string) {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function formatCommand(plan: PreviewTunnelPlan) {
  if (plan.shell) return plan.command;
  return [plan.command, ...plan.args].join(" ");
}

function normalizeLocalUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function createLocalUrl(host: string, port: number) {
  return `http://${host}:${port}`;
}

function normalizePort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function uniqueNumbers(values: Array<number | undefined>) {
  return [...new Set(values.filter((value): value is number => value !== undefined))];
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

function normalizePreviewDomain(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/^\.*/, "").replace(/\/*$/, "");
}
