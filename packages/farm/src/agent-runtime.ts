import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { defineIntegration, type FarmIntegration } from "./integrations";
import type { BundleResultPayload, FarmPlugin } from "./plugin";

const AGENT_RUNTIME_METHODS = [
  "GET",
  "HEAD",
  "QUERY",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;
const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface FarmAgentRuntimeInstance {
  readonly provider: string;
  readonly routePrefix: string;
  readonly routePrefixes: readonly string[];
  getOrigin(): string | undefined;
}

export interface FarmManagedAgentRuntime {
  readonly origin: string;
  readonly process?: ChildProcess;
  stop(): Promise<void>;
}

export interface FarmAgentRuntimeStartContext {
  readonly root: string;
  readonly log: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface FarmAgentRuntimeBuildContext extends BundleResultPayload {
  readonly provider: string;
  readonly routePrefix: string;
  readonly routePrefixes: readonly string[];
}

export interface FarmAgentRuntimeIntegrationOptions {
  provider: string;
  routePrefix: string;
  /** Whether Farm's production server must dispatch this runtime's proxy routes. */
  serverRuntime?: boolean;
  additionalRoutePrefixes?: readonly string[];
  origin?: string;
  originEnv?: string | readonly string[];
  webSockets?: boolean;
  startDev?(context: FarmAgentRuntimeStartContext): Promise<FarmManagedAgentRuntime>;
  afterBuild?(context: FarmAgentRuntimeBuildContext): Promise<void> | void;
  plugins?: readonly FarmPlugin[];
  instance?: Record<string, unknown>;
}

export interface FarmManagedProcessOptions {
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  label: string;
  origin?: string;
  resolveOrigin?(output: string): string | undefined;
  healthPath?: string;
  timeoutMs?: number;
  stopTimeoutMs?: number;
  onOutput?(line: string, stream: "stdout" | "stderr"): void;
}

export interface FarmAgentProxyOptions {
  fetch?: typeof globalThis.fetch;
}

interface RuntimeState {
  origin?: string;
  managed?: FarmManagedAgentRuntime;
}

export function createAgentRuntimeIntegration(
  options: FarmAgentRuntimeIntegrationOptions,
): FarmIntegration {
  const provider = normalizeProviderName(options.provider);
  const routePrefix = normalizeAgentRoutePrefix(options.routePrefix);
  const routePrefixes = [
    routePrefix,
    ...(options.additionalRoutePrefixes || []).map(normalizeAgentRoutePrefix),
  ].filter((prefix, index, values) => values.indexOf(prefix) === index);
  const originEnv = normalizeOriginEnv(options.originEnv);
  const state: RuntimeState = {
    origin: resolveConfiguredOrigin(options.origin, originEnv),
  };

  const runtimeInstance: FarmAgentRuntimeInstance & Record<string, unknown> = {
    ...options.instance,
    provider,
    routePrefix,
    routePrefixes,
    getOrigin: () => state.origin ?? resolveConfiguredOrigin(options.origin, originEnv),
  };

  const runtimePlugin: FarmPlugin = {
    name: `farm:agent-runtime:${provider}`,
    config(config, context) {
      if (!context.isDev) {
        return config;
      }

      const origin = runtimeInstance.getOrigin();
      if (!origin) {
        return config;
      }

      for (const prefix of routePrefixes) {
        applyAgentRuntimeViteProxy(config, {
          origin,
          routePrefix: prefix,
          webSockets: options.webSockets,
        });
      }
      return config;
    },
    async afterBundle(result) {
      if (!result.success || !options.afterBuild) {
        return;
      }

      await options.afterBuild({
        ...result,
        provider,
        routePrefix,
        routePrefixes,
      });
    },
  };

  return defineIntegration({
    category: "agent",
    type: provider,
    serverRuntime: options.serverRuntime,
    instance: runtimeInstance,
    async setup(context) {
      if (!context.isDev || state.origin || !options.startDev) {
        return;
      }

      state.managed = await options.startDev({
        root: context.appConfig.root || process.cwd(),
        log: context.log,
      });
      state.origin = normalizeAgentOrigin(state.managed.origin);
      context.log.info(`${provider} runtime ready`, {
        origin: state.origin,
      });
      await context.cleanup(async () => {
        await state.managed?.stop();
        state.managed = undefined;
        state.origin = undefined;
      });
    },
    routes: routePrefixes.map((prefix) => ({
      path: `${prefix}/[...farmAgentRuntimePath]`,
      methods: AGENT_RUNTIME_METHODS,
      rawBody: true,
      async handler(request) {
        const origin = runtimeInstance.getOrigin();
        if (!origin) {
          return Response.json(
            {
              error: "Agent runtime unavailable",
              provider,
            },
            { status: 503 },
          );
        }

        return proxyAgentRuntimeRequest(request, origin);
      },
    })),
    plugins: [runtimePlugin, ...(options.plugins || [])],
  });
}

export function applyAgentRuntimeViteProxy(
  config: { vite?: Record<string, any> },
  input: {
    origin: string;
    routePrefix: string;
    webSockets?: boolean;
  },
): void {
  const origin = normalizeAgentOrigin(input.origin);
  const routePrefix = normalizeAgentRoutePrefix(input.routePrefix);
  const vite = config.vite || {};
  const server = vite.server || {};
  const proxy = server.proxy || {};

  if (proxy[routePrefix]) {
    throw new Error(
      `Farm agent runtime cannot own ${routePrefix} because vite.server.proxy already defines it.`,
    );
  }

  config.vite = {
    ...vite,
    server: {
      ...server,
      proxy: {
        ...proxy,
        [routePrefix]: {
          target: origin,
          changeOrigin: true,
          ws: input.webSockets === true,
        },
      },
    },
  };
}

export async function proxyAgentRuntimeRequest(
  request: Request,
  origin: string,
  options: FarmAgentProxyOptions = {},
): Promise<Response> {
  const upstreamOrigin = normalizeAgentOrigin(origin);
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, upstreamOrigin);
  const headers = createProxyRequestHeaders(request.headers, incomingUrl);
  const method = request.method.toUpperCase();
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual",
    signal: request.signal,
  };

  if (method !== "GET" && method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const upstream = await (options.fetch || globalThis.fetch)(targetUrl, init);
    const responseHeaders = new Headers(upstream.headers);
    removeHopByHopHeaders(responseHeaders);
    rewriteProxyLocation(responseHeaders, upstreamOrigin, incomingUrl.origin);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      throw error;
    }

    return Response.json(
      {
        error: "Agent runtime request failed",
      },
      { status: 502 },
    );
  }
}

export async function startManagedAgentRuntime(
  options: FarmManagedProcessOptions,
): Promise<FarmManagedAgentRuntime> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const stopTimeoutMs = options.stopTimeoutMs ?? 2_000;
  const fixedOrigin = options.origin ? normalizeAgentOrigin(options.origin) : undefined;
  let output = "";
  let settled = false;
  let checkingReadiness = false;

  const child = spawn(options.command, [...(options.args || [])], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const origin = await new Promise<string>((resolveOrigin, reject) => {
    let timer: ReturnType<typeof setTimeout>;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const succeed = async (candidate: string) => {
      if (settled || checkingReadiness) return;
      checkingReadiness = true;
      try {
        const normalized = normalizeAgentOrigin(candidate);
        await waitForAgentRuntime(normalized, options.healthPath, timeoutMs, child);
        finish();
        resolveOrigin(normalized);
      } catch (error) {
        finish();
        terminateChild(child);
        reject(error);
      }
    };

    timer = setTimeout(() => {
      finish();
      terminateChild(child);
      reject(new Error(`${options.label} did not become ready within ${timeoutMs}ms.`));
    }, timeoutMs);

    const onError = (error: Error) => {
      finish();
      reject(error);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish();
      reject(
        new Error(
          `${options.label} exited before it was ready (code ${String(code)}, signal ${String(signal)}).`,
        ),
      );
    };

    const onData = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      output = `${output}${text}`.slice(-16_384);
      emitProcessOutput(text, stream, options.onOutput);

      if (!fixedOrigin && options.resolveOrigin) {
        const candidate = options.resolveOrigin(output);
        if (candidate) {
          void succeed(candidate);
        }
      }
    };

    child.once("error", onError);
    child.once("exit", onExit);
    child.stdout?.on("data", (chunk: Buffer) => onData(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => onData(chunk, "stderr"));

    if (fixedOrigin) {
      void succeed(fixedOrigin);
    }
  });

  return {
    origin,
    process: child,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      child.kill("SIGTERM");
      const exited = await waitForChildExit(child, stopTimeoutMs);
      if (!exited && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForChildExit(child, stopTimeoutMs);
      }
    },
  };
}

export async function findAvailableAgentRuntimePort(host = "127.0.0.1"): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate an agent runtime port."));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

export async function resolveProjectPackageBin(
  projectRoot: string,
  packageName: string,
  binName?: string,
): Promise<string> {
  const root = resolve(projectRoot);
  const projectRequire = createRequire(join(root, "package.json"));
  let packageJsonPath: string;

  try {
    packageJsonPath = projectRequire.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(
      `${packageName} is required by this agent integration. Install it in ${root} and try again.`,
    );
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.[binName || packageName.split("/").at(-1) || packageName];

  if (!bin) {
    throw new Error(
      `${packageName} does not expose the expected ${binName || packageName} binary.`,
    );
  }

  const packageRoot = dirname(packageJsonPath);
  const binaryPath = resolve(packageRoot, bin);
  if (
    relative(packageRoot, binaryPath).startsWith("..") ||
    isAbsolute(relative(packageRoot, binaryPath))
  ) {
    throw new Error(`${packageName} exposes a binary outside its package root.`);
  }

  return binaryPath;
}

export function normalizeAgentOrigin(value: string): string {
  const input = value.trim();
  if (!input) {
    throw new Error("Agent runtime origin cannot be empty.");
  }

  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Agent runtime origin must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Agent runtime origin cannot contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Agent runtime origin must not contain a path, query, or hash.");
  }

  return url.origin;
}

export function normalizeAgentRoutePrefix(value: string): string {
  const normalized = `/${value.trim()}`.replace(/\/{2,}/g, "/");
  if (normalized === "/") {
    throw new Error("Agent runtime route prefix cannot own the application root.");
  }
  return normalized.replace(/\/$/, "");
}

function normalizeProviderName(value: string): string {
  const provider = value.trim();
  if (!provider || !/^[a-z0-9][a-z0-9._-]*$/i.test(provider)) {
    throw new Error("Agent runtime provider must be a non-empty package-style name.");
  }
  return provider;
}

function normalizeOriginEnv(value: string | readonly string[] | undefined): readonly string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => entry.trim()).filter(Boolean);
}

function resolveConfiguredOrigin(
  configuredOrigin: string | undefined,
  envNames: readonly string[],
): string | undefined {
  if (configuredOrigin) {
    return normalizeAgentOrigin(configuredOrigin);
  }

  for (const envName of envNames) {
    const value = process.env[envName];
    if (value?.trim()) {
      return normalizeAgentOrigin(value);
    }
  }

  return undefined;
}

function createProxyRequestHeaders(input: Headers, incomingUrl: URL): Headers {
  const headers = new Headers(input);
  removeHopByHopHeaders(headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  if (!headers.has("x-forwarded-host")) headers.set("x-forwarded-host", incomingUrl.host);
  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));
  }
  return headers;
}

function removeHopByHopHeaders(headers: Headers): void {
  const connection = headers.get("connection");
  if (connection) {
    for (const value of connection.split(",")) {
      const header = value.trim();
      if (HTTP_HEADER_NAME.test(header)) {
        headers.delete(header);
      }
    }
  }

  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
}

function rewriteProxyLocation(
  headers: Headers,
  upstreamOrigin: string,
  incomingOrigin: string,
): void {
  const location = headers.get("location");
  if (!location) return;

  try {
    const url = new URL(location, upstreamOrigin);
    if (url.origin === upstreamOrigin) {
      headers.set("location", `${incomingOrigin}${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // Preserve non-URL Location values exactly as returned by the runtime.
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function waitForAgentRuntime(
  origin: string,
  healthPath: string | undefined,
  timeoutMs: number,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL(healthPath || "/", origin);

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Agent runtime exited while Farm was waiting for it to become ready.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 750);
    try {
      await fetch(healthUrl, {
        signal: controller.signal,
        redirect: "manual",
      });
      return;
    } catch {
      await delay(100);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Agent runtime at ${origin} did not answer before the startup timeout.`);
}

function emitProcessOutput(
  text: string,
  stream: "stdout" | "stderr",
  onOutput: FarmManagedProcessOptions["onOutput"],
): void {
  if (!onOutput) return;
  for (const line of text.split(/\r?\n/)) {
    const value = line.trimEnd();
    if (value) onOutput(value, stream);
  }
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolveExit) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
