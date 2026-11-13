export const FARM_DEPLOYMENT_ID_HEADER = "x-farm-deployment-id";
export const FARM_DEPLOYMENT_MISMATCH_HEADER = "x-farm-deployment-mismatch";
export const FARM_DEPLOYMENT_COOKIE = "__farm_deployment";
export const FARM_DEPLOYMENT_MISMATCH_CODE = "FARM_DEPLOYMENT_MISMATCH";
export const FARM_DEPLOYMENT_MISMATCH_STATUS = 409;

export type FarmPresetRuntime = "node" | "edge" | "unknown";

export function getFarmPresetRuntime(preset: string): FarmPresetRuntime {
  if (
    preset === "cloudflare" ||
    preset === "cloudflare-pages" ||
    preset === "cloudflare-module" ||
    preset === "netlify-edge" ||
    preset === "deno"
  ) {
    return "edge";
  }

  if (
    preset === "node-server" ||
    preset === "vercel" ||
    preset === "netlify" ||
    preset === "aws-lambda" ||
    preset === "azure" ||
    preset === "firebase" ||
    preset === "bun" ||
    preset === "self-host" ||
    preset === "farm"
  ) {
    return "node";
  }

  return "unknown";
}

export interface FarmDeploymentMismatch {
  clientDeploymentId: string;
  serverDeploymentId: string;
}

export interface FarmDeploymentResponseOptions {
  setCookie?: boolean;
  cookiePath?: string;
  secureCookie?: boolean;
}

export class FarmDeploymentMismatchError extends Error {
  readonly name = "FarmDeploymentMismatchError";
  readonly code = FARM_DEPLOYMENT_MISMATCH_CODE;
  readonly retryable = false;

  constructor(
    readonly clientDeploymentId: string,
    readonly serverDeploymentId: string,
  ) {
    super("The application was updated while this page was open. Refresh before trying again.");
  }
}

export function normalizeFarmDeploymentId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("Farm deploymentId must be a non-empty string");
  }

  const normalized = value.trim();
  if (normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError("Farm deploymentId must be at most 200 characters without control bytes");
  }

  return normalized;
}

export function createFarmDeploymentRequestHeaders(
  deploymentId: string | undefined,
  init?: HeadersInit,
): Headers {
  const headers = new Headers(init);
  if (deploymentId) {
    headers.set(FARM_DEPLOYMENT_ID_HEADER, deploymentId);
  }
  return headers;
}

export function getFarmRequestDeploymentId(
  request: Pick<Request, "headers" | "method">,
): string | undefined {
  const headerValue = request.headers.get(FARM_DEPLOYMENT_ID_HEADER)?.trim();
  if (headerValue) return headerValue;

  if (isSafeRequestMethod(request.method)) return undefined;
  return readCookie(request.headers.get("cookie"), FARM_DEPLOYMENT_COOKIE);
}

export function getFarmDeploymentMismatch(
  request: Pick<Request, "headers" | "method">,
  serverDeploymentId: string | undefined,
): FarmDeploymentMismatch | null {
  if (!serverDeploymentId) return null;

  const clientDeploymentId = getFarmRequestDeploymentId(request);
  if (!clientDeploymentId || clientDeploymentId === serverDeploymentId) return null;

  return { clientDeploymentId, serverDeploymentId };
}

export function createFarmDeploymentMismatchResponse(mismatch: FarmDeploymentMismatch): Response {
  return new Response(
    JSON.stringify({
      error: FARM_DEPLOYMENT_MISMATCH_CODE,
      message: "The application deployment changed. Refresh before retrying this request.",
    }),
    {
      status: FARM_DEPLOYMENT_MISMATCH_STATUS,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        [FARM_DEPLOYMENT_ID_HEADER]: mismatch.serverDeploymentId,
        [FARM_DEPLOYMENT_MISMATCH_HEADER]: "1",
      },
    },
  );
}

export function withFarmDeploymentResponse(
  response: Response,
  deploymentId: string | undefined,
  options: FarmDeploymentResponseOptions = {},
): Response {
  if (!deploymentId) return response;

  const headers = new Headers(response.headers);
  headers.set(FARM_DEPLOYMENT_ID_HEADER, deploymentId);
  if (options.setCookie) {
    headers.append(
      "Set-Cookie",
      createFarmDeploymentCookie(
        deploymentId,
        options.cookiePath ?? "/",
        options.secureCookie ?? false,
      ),
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function getFarmResponseDeploymentId(
  response: Pick<Response, "headers">,
): string | undefined {
  return response.headers.get(FARM_DEPLOYMENT_ID_HEADER)?.trim() || undefined;
}

export function isFarmDeploymentMismatchResponse(
  response: Pick<Response, "headers" | "status">,
  clientDeploymentId: string | undefined,
): boolean {
  const serverDeploymentId = getFarmResponseDeploymentId(response);
  if (clientDeploymentId && serverDeploymentId && clientDeploymentId !== serverDeploymentId) {
    return true;
  }

  return (
    response.status === FARM_DEPLOYMENT_MISMATCH_STATUS &&
    response.headers.get(FARM_DEPLOYMENT_MISMATCH_HEADER) === "1"
  );
}

export function createFarmDeploymentMismatchError(
  response: Pick<Response, "headers">,
  clientDeploymentId: string,
): FarmDeploymentMismatchError {
  return new FarmDeploymentMismatchError(
    clientDeploymentId,
    getFarmResponseDeploymentId(response) || "unknown",
  );
}

export function createFarmDeploymentCookie(
  deploymentId: string,
  path = "/",
  secure = false,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return [
    `${FARM_DEPLOYMENT_COOKIE}=${encodeURIComponent(deploymentId)}`,
    `Path=${normalizedPath}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

function isSafeRequestMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS", "QUERY"].includes(method.toUpperCase());
}

const CLOUDFLARE_POPULATE_PROCESS_ENV_FLAG = "nodejs_compat_populate_process_env";
const CLOUDFLARE_DO_NOT_POPULATE_PROCESS_ENV_FLAG = "nodejs_compat_do_not_populate_process_env";
/** The compatibility date from which Workers populate `process.env` by default. */
const CLOUDFLARE_POPULATE_PROCESS_ENV_DATE = "2025-04-01";

/**
 * The compatibility flags a generated Wrangler config needs so the worker's vars
 * and secrets reach `process.env`, or undefined when it needs no change.
 *
 * Farm builds Workers at a compatibility date before `process.env` was populated
 * by default, so server code reading it, such as an integration falling back to
 * `process.env.STRIPE_SECRET_KEY`, saw none of them. A config whose date already
 * populates `process.env`, or that opts out, is left as it is, since workerd
 * refuses to start with both flags.
 */
export function resolveCloudflareProcessEnvFlags(wrangler: {
  compatibility_date?: unknown;
  compatibility_flags?: unknown;
}): string[] | undefined {
  const date = wrangler.compatibility_date;
  const flags = wrangler.compatibility_flags;
  if (typeof date !== "string" || date >= CLOUDFLARE_POPULATE_PROCESS_ENV_DATE) return undefined;
  if (!Array.isArray(flags) || !flags.includes("nodejs_compat")) return undefined;
  if (
    flags.includes(CLOUDFLARE_POPULATE_PROCESS_ENV_FLAG) ||
    flags.includes(CLOUDFLARE_DO_NOT_POPULATE_PROCESS_ENV_FLAG)
  ) {
    return undefined;
  }
  return [...flags, CLOUDFLARE_POPULATE_PROCESS_ENV_FLAG];
}
