import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import os from "node:os";
import path from "node:path";
import {
  FARM_CREATE_APP_TELEMETRY_COMMANDS,
  FARM_TELEMETRY_COMMANDS,
  FARM_TELEMETRY_DEPLOY_TARGETS,
  FARM_TELEMETRY_PACKAGE_MANAGERS,
  FARM_TELEMETRY_RENDERERS,
  FARM_TELEMETRY_TEMPLATES,
} from "./telemetry-contract";

const TELEMETRY_SCHEMA_VERSION = 1 as const;
const DEFAULT_TELEMETRY_ENDPOINT = "https://farmjs.dev/api/telemetry/v1/events";
const TELEMETRY_NOTICE_URL = "https://farmjs.dev/docs/telemetry";
const REQUEST_TIMEOUT_MS = 3_000;
const RETRY_DELAYS_MS = [250, 750] as const;

export type FarmTelemetryCommand = (typeof FARM_TELEMETRY_COMMANDS)[number];
export type FarmCreateAppTelemetryCommand = (typeof FARM_CREATE_APP_TELEMETRY_COMMANDS)[number];
export type FarmTelemetryTemplate = (typeof FARM_TELEMETRY_TEMPLATES)[number];
export type FarmTelemetryRenderer = (typeof FARM_TELEMETRY_RENDERERS)[number];
export type FarmTelemetryPackageManager = (typeof FARM_TELEMETRY_PACKAGE_MANAGERS)[number];
export type FarmTelemetryDeployTarget = (typeof FARM_TELEMETRY_DEPLOY_TARGETS)[number];

interface FarmTelemetryConfig {
  version: 1;
  enabled: boolean;
  noticeShown: boolean;
  anonymousId?: string;
}

interface FarmTelemetryConfigState {
  config: FarmTelemetryConfig;
  stored: boolean;
}

interface FarmTelemetryEventBase {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  eventId: string;
  anonymousId: string;
  source: "cli" | "create-app";
  packageName: "@farm.js/cli" | "@farm.js/create-app";
  packageVersion: string;
  nodeMajor: number;
  platform: "darwin" | "linux" | "windows" | "other";
  architecture: "arm64" | "x64" | "other";
}

export interface FarmCommandTelemetryInput {
  command: FarmTelemetryCommand;
  packageVersion: string;
  deployTarget?: string;
}

export interface FarmCreateAppCommandTelemetryInput {
  command: FarmCreateAppTelemetryCommand;
  packageVersion: string;
}

export interface FarmProjectCreatedTelemetryInput {
  packageVersion: string;
  template?: string;
  renderer?: string;
  packageManager?: string;
  typescript?: boolean;
  installedDependencies?: boolean;
}

export interface FarmTelemetryStatus {
  enabled: boolean;
  active: boolean;
  source: "configuration" | "environment" | "default";
  endpoint: string;
  configFile: string;
  anonymousId?: string;
  reason?: string;
}

type FarmTelemetryEvent =
  | (FarmTelemetryEventBase & {
      eventType: "command_invoked";
      source: "cli";
      packageName: "@farm.js/cli";
      command: FarmTelemetryCommand;
      deployTarget?: FarmTelemetryDeployTarget;
    })
  | (FarmTelemetryEventBase & {
      eventType: "command_invoked";
      source: "create-app";
      packageName: "@farm.js/create-app";
      command: FarmCreateAppTelemetryCommand;
    })
  | (FarmTelemetryEventBase & {
      eventType: "project_created";
      source: "create-app";
      packageName: "@farm.js/create-app";
      template?: FarmTelemetryTemplate;
      renderer?: FarmTelemetryRenderer;
      packageManager?: FarmTelemetryPackageManager;
      typescript?: boolean;
      installedDependencies?: boolean;
    });

type FarmTelemetryGeneratedFields = Pick<
  FarmTelemetryEventBase,
  "schemaVersion" | "eventId" | "anonymousId" | "nodeMajor" | "platform" | "architecture"
>;
type FarmTelemetryEventInput<T = FarmTelemetryEvent> = T extends FarmTelemetryEvent
  ? Omit<T, keyof FarmTelemetryGeneratedFields>
  : never;

const pendingDeliveries = new Set<Promise<void>>();
const retryTimers = new Set<NodeJS.Timeout>();
let telemetryFlushWaiters = 0;

function defaultConfig(): FarmTelemetryConfig {
  return {
    version: TELEMETRY_SCHEMA_VERSION,
    enabled: true,
    noticeShown: false,
  };
}

function configDirectory(): string {
  if (process.env.FARM_TELEMETRY_CONFIG_DIR) {
    return path.resolve(process.env.FARM_TELEMETRY_CONFIG_DIR);
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "farmjs",
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "farmjs");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "farmjs");
}

export function getFarmTelemetryConfigFile(): string {
  return path.join(configDirectory(), "telemetry.json");
}

async function readConfig(): Promise<FarmTelemetryConfigState> {
  try {
    const parsed = JSON.parse(
      await readFile(getFarmTelemetryConfigFile(), "utf8"),
    ) as Partial<FarmTelemetryConfig>;
    if (parsed.version !== TELEMETRY_SCHEMA_VERSION) {
      return { config: defaultConfig(), stored: false };
    }
    return {
      config: {
        version: TELEMETRY_SCHEMA_VERSION,
        enabled: parsed.enabled === true,
        noticeShown: parsed.noticeShown === true,
        anonymousId: isUuid(parsed.anonymousId) ? parsed.anonymousId : undefined,
      },
      stored: true,
    };
  } catch {
    return { config: defaultConfig(), stored: false };
  }
}

async function writeConfig(config: FarmTelemetryConfig): Promise<void> {
  const file = getFarmTelemetryConfigFile();
  const directory = path.dirname(file);
  const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporaryFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryFile, file);
    await chmod(file, 0o600).catch(() => undefined);
  } catch {
    await unlink(temporaryFile).catch(() => undefined);
    // Telemetry is best-effort and must never make a Farm command fail.
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isTrue(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function isFalse(value: string | undefined): boolean {
  return value !== undefined && ["0", "false", "no", "off"].includes(value.toLowerCase());
}

function environmentDecision(): { enabled?: boolean; reason?: string } {
  if (process.env.DO_NOT_TRACK !== undefined && !isFalse(process.env.DO_NOT_TRACK)) {
    return { enabled: false, reason: "DO_NOT_TRACK is set" };
  }
  if (isTrue(process.env.FARM_TELEMETRY_DISABLED)) {
    return { enabled: false, reason: "FARM_TELEMETRY_DISABLED is set" };
  }
  if (isTrue(process.env.FARM_TELEMETRY)) return { enabled: true };
  if (isFalse(process.env.FARM_TELEMETRY)) {
    return { enabled: false, reason: "FARM_TELEMETRY disables collection" };
  }
  return {};
}

function isContinuousIntegration(): boolean {
  return (
    isTrue(process.env.CI) ||
    isTrue(process.env.GITHUB_ACTIONS) ||
    isTrue(process.env.BUILDKITE) ||
    isTrue(process.env.CIRCLECI)
  );
}

function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function getEndpoint(): string {
  const candidate = process.env.FARM_TELEMETRY_ENDPOINT || DEFAULT_TELEMETRY_ENDPOINT;
  try {
    const url = new URL(candidate);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
      return DEFAULT_TELEMETRY_ENDPOINT;
    }
    return url.toString();
  } catch {
    return DEFAULT_TELEMETRY_ENDPOINT;
  }
}

async function resolveState(): Promise<{
  config: FarmTelemetryConfig;
  enabled: boolean;
  active: boolean;
  source: FarmTelemetryStatus["source"];
  reason?: string;
}> {
  const { config, stored } = await readConfig();
  const environment = environmentDecision();
  const enabled = environment.enabled ?? config.enabled;
  const source =
    environment.enabled !== undefined ? "environment" : stored ? "configuration" : "default";

  if (!enabled) return { config, enabled, active: false, source, reason: environment.reason };
  if (environment.enabled === true) return { config, enabled, active: true, source };
  if (process.env.NODE_ENV === "test") {
    return { config, enabled, active: false, source, reason: "test environments are skipped" };
  }
  if (isContinuousIntegration()) {
    return { config, enabled, active: false, source, reason: "CI environments are skipped" };
  }
  if (!isInteractive()) {
    return {
      config,
      enabled,
      active: false,
      source,
      reason: "non-interactive commands are skipped",
    };
  }
  return { config, enabled, active: true, source };
}

export async function getFarmTelemetryStatus(): Promise<FarmTelemetryStatus> {
  const state = await resolveState();
  return {
    enabled: state.enabled,
    active: state.active,
    source: state.source,
    endpoint: getEndpoint(),
    configFile: getFarmTelemetryConfigFile(),
    anonymousId: state.config.anonymousId,
    reason: state.reason,
  };
}

export async function setFarmTelemetryEnabled(enabled: boolean): Promise<FarmTelemetryStatus> {
  const { config: current } = await readConfig();
  await writeConfig({
    version: TELEMETRY_SCHEMA_VERSION,
    enabled,
    noticeShown: true,
    anonymousId: enabled ? current.anonymousId || randomUUID() : undefined,
  });
  return getFarmTelemetryStatus();
}

export async function showFarmTelemetryNotice(): Promise<void> {
  if (!isInteractive() || isContinuousIntegration() || process.env.NODE_ENV === "test") return;
  if (environmentDecision().enabled !== undefined) return;
  const { config } = await readConfig();
  if (config.noticeShown) return;
  process.stderr.write(
    `Farm.js collects anonymous CLI telemetry by default. Run "farm telemetry disable" to opt out.\nLearn more: ${TELEMETRY_NOTICE_URL}\n`,
  );
  await writeConfig({ ...config, noticeShown: true });
}

export function resolveFarmTelemetryCommand(value: string): FarmTelemetryCommand | undefined {
  return (FARM_TELEMETRY_COMMANDS as readonly string[]).includes(value)
    ? (value as FarmTelemetryCommand)
    : undefined;
}

export function resolveFarmCreateAppTelemetryCommand(
  value: string,
): FarmCreateAppTelemetryCommand | undefined {
  return (FARM_CREATE_APP_TELEMETRY_COMMANDS as readonly string[]).includes(value)
    ? (value as FarmCreateAppTelemetryCommand)
    : undefined;
}

export function trackFarmCommand(input: FarmCommandTelemetryInput): Promise<void> {
  return schedule(async () => {
    await showFarmTelemetryNotice();
    const deployTarget = allowlisted(input.deployTarget, FARM_TELEMETRY_DEPLOY_TARGETS);
    await track({
      eventType: "command_invoked",
      source: "cli",
      packageName: "@farm.js/cli",
      packageVersion: sanitizeVersion(input.packageVersion),
      command: input.command,
      ...(deployTarget ? { deployTarget } : {}),
    });
  });
}

export function trackFarmCreateAppCommand(
  input: FarmCreateAppCommandTelemetryInput,
): Promise<void> {
  return schedule(async () => {
    await showFarmTelemetryNotice();
    const command = allowlisted(input.command, FARM_CREATE_APP_TELEMETRY_COMMANDS);
    if (!command) return;
    await track({
      eventType: "command_invoked",
      source: "create-app",
      packageName: "@farm.js/create-app",
      packageVersion: sanitizeVersion(input.packageVersion),
      command,
    });
  });
}

export function trackFarmProjectCreated(input: FarmProjectCreatedTelemetryInput): Promise<void> {
  return schedule(async () => {
    const template = allowlisted(input.template, FARM_TELEMETRY_TEMPLATES);
    const renderer = allowlisted(input.renderer, FARM_TELEMETRY_RENDERERS);
    const packageManager = allowlisted(input.packageManager, FARM_TELEMETRY_PACKAGE_MANAGERS);
    await track({
      eventType: "project_created",
      source: "create-app",
      packageName: "@farm.js/create-app",
      packageVersion: sanitizeVersion(input.packageVersion),
      ...(template ? { template } : {}),
      ...(renderer ? { renderer } : {}),
      ...(packageManager ? { packageManager } : {}),
      ...(typeof input.typescript === "boolean" ? { typescript: input.typescript } : {}),
      ...(typeof input.installedDependencies === "boolean"
        ? { installedDependencies: input.installedDependencies }
        : {}),
    });
  });
}

function schedule(delivery: () => Promise<void>): Promise<void> {
  const pending = Promise.resolve()
    .then(delivery)
    .catch(() => {
      // Telemetry is best-effort and must never surface as an unhandled rejection.
    });
  pendingDeliveries.add(pending);
  void pending.finally(() => pendingDeliveries.delete(pending));
  return Promise.resolve();
}

/** Wait for background telemetry. Intended for tests and explicit process shutdown hooks. */
export async function flushFarmTelemetry(): Promise<void> {
  telemetryFlushWaiters += 1;
  for (const timer of retryTimers) timer.ref?.();
  try {
    while (pendingDeliveries.size > 0) {
      await Promise.allSettled(pendingDeliveries);
    }
  } finally {
    telemetryFlushWaiters -= 1;
    if (telemetryFlushWaiters === 0) {
      for (const timer of retryTimers) timer.unref?.();
    }
  }
}

async function track(event: FarmTelemetryEventInput): Promise<void> {
  try {
    const state = await resolveState();
    if (!state.active) return;
    const anonymousId = state.config.anonymousId || randomUUID();
    if (!state.config.anonymousId) {
      await writeConfig({ ...state.config, anonymousId });
    }
    const payload = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      eventId: randomUUID(),
      anonymousId,
      nodeMajor: Number.parseInt(process.versions.node.split(".")[0] || "0", 10),
      platform: normalizePlatform(process.platform),
      architecture: normalizeArchitecture(process.arch),
      ...event,
    } as FarmTelemetryEvent;
    await send(payload);
  } catch {
    // Telemetry is best-effort and must never make a Farm command fail.
  }
}

async function send(payload: FarmTelemetryEvent): Promise<void> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await sendOnce(payload);
    if (result === "delivered" || result === "rejected") return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await wait(delay);
  }
  debug("delivery failed after retries");
}

async function sendOnce(payload: FarmTelemetryEvent): Promise<"delivered" | "retry" | "rejected"> {
  let endpoint: URL;
  try {
    endpoint = new URL(getEndpoint());
  } catch {
    debug("invalid endpoint URL");
    return "rejected";
  }

  const requestTransport = endpoint.protocol === "http:" ? httpRequest : httpsRequest;
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    debug(`unsupported endpoint protocol ${endpoint.protocol}`);
    return "rejected";
  }

  const body = JSON.stringify(payload);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: "delivered" | "retry" | "rejected") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const request = requestTransport(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.on("error", () => {
          // The status code is sufficient; response bodies are never telemetry input.
        });
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) return finish("delivered");
        if (status === 408 || status === 425 || status === 429) {
          debug(`temporary HTTP ${status}; retrying`);
          return finish("retry");
        }
        if (status >= 500) {
          debug(`server HTTP ${status}; retrying`);
          return finish("retry");
        }
        debug(`event rejected with HTTP ${status}`);
        return finish("rejected");
      },
    );
    const timeout = setTimeout(() => {
      request.destroy();
      debug("network request timed out; retrying");
      finish("retry");
    }, REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    request.once("socket", (socket) => socket.unref());
    request.once("error", () => {
      debug("network request failed; retrying");
      finish("retry");
    });
    request.end(body);
  });
}

function wait(delay: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      retryTimers.delete(timeout);
      resolve();
    }, delay);
    retryTimers.add(timeout);
    if (telemetryFlushWaiters === 0) timeout.unref?.();
  });
}

function debug(message: string): void {
  if (!isTrue(process.env.FARM_TELEMETRY_DEBUG)) return;
  process.stderr.write(`[farm.telemetry] ${message}\n`);
}

function sanitizeVersion(value: string): string {
  return /^[0-9A-Za-z.+_-]{1,64}$/.test(value) ? value : "unknown";
}

function allowlisted<const T extends readonly string[]>(
  value: string | undefined,
  values: T,
): T[number] | undefined {
  return value && (values as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

function normalizePlatform(value: NodeJS.Platform): FarmTelemetryEventBase["platform"] {
  if (value === "darwin" || value === "linux") return value;
  if (value === "win32") return "windows";
  return "other";
}

function normalizeArchitecture(value: string): FarmTelemetryEventBase["architecture"] {
  return value === "arm64" || value === "x64" ? value : "other";
}
