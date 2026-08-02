import {
  FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY,
  defineIntegration,
  integrationRoute,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
} from "@farm.js/core";
import { api as clientApi } from "@farm.js/core/client";
import { createPathInferredClientApi, integrationConfig } from "@farm.js/integration-utils";

const DEFAULT_UNKEY_BASE_URL = "https://api.unkey.com";

export interface UnkeyAPIEnvelope<TData> {
  meta?: {
    requestId?: string;
    [key: string]: unknown;
  };
  data: TData;
}

export interface UnkeyRatelimitRequest {
  name: string;
  limit?: number;
  duration?: number;
  cost?: number;
  autoApply?: boolean;
}

export interface UnkeyCreditsInput {
  remaining?: number | null;
  refill?: {
    interval: "daily" | "monthly";
    amount: number;
    refillDay?: number;
  } | null;
}

export interface UnkeyCreateKeyInput {
  apiId?: string;
  prefix?: string;
  name?: string;
  byteLength?: number;
  externalId?: string;
  meta?: Record<string, unknown>;
  roles?: string[];
  permissions?: string[];
  expires?: number;
  credits?: UnkeyCreditsInput;
  ratelimits?: UnkeyRatelimitRequest[];
}

export interface UnkeyCreateKeyResult {
  keyId: string;
  key: string;
}

export interface UnkeyVerifyKeyInput {
  key: string;
  tags?: string[];
  permissions?: string;
  credits?: {
    cost?: number;
  };
  ratelimits?: Array<{
    name: string;
    cost?: number;
    limit?: number;
    duration?: number;
  }>;
  migrationId?: string;
}

export interface UnkeyVerificationIdentity {
  id?: string;
  externalId?: string;
  meta?: Record<string, unknown>;
  ratelimits?: UnkeyRatelimitRequest[];
}

export interface UnkeyRatelimitState {
  exceeded?: boolean;
  id?: string;
  name?: string;
  limit?: number;
  duration?: number;
  reset?: number;
  remaining?: number;
  autoApply?: boolean;
}

export interface UnkeyVerifyKeyResult {
  valid: boolean;
  code?: string;
  keyId?: string;
  name?: string;
  meta?: Record<string, unknown>;
  expires?: number;
  credits?: number;
  enabled?: boolean;
  permissions?: string[];
  roles?: string[];
  identity?: UnkeyVerificationIdentity;
  ratelimits?: UnkeyRatelimitState[];
}

export interface UnkeyUpdateKeyInput {
  keyId: string;
  name?: string | null;
  externalId?: string | null;
  meta?: Record<string, unknown> | null;
  expires?: number | null;
  credits?: UnkeyCreditsInput | null;
  ratelimits?: UnkeyRatelimitRequest[] | null;
  enabled?: boolean;
  roles?: string[];
  permissions?: string[];
}

export interface UnkeyDeleteKeyInput {
  keyId: string;
  permanent?: boolean;
}

export interface UnkeyRevokeKeyInput {
  keyId: string;
}

export interface UnkeyClient {
  createKey(input: UnkeyCreateKeyInput): Promise<UnkeyCreateKeyResult>;
  verifyKey(input: UnkeyVerifyKeyInput): Promise<UnkeyVerifyKeyResult>;
  updateKey(input: UnkeyUpdateKeyInput): Promise<Record<string, never>>;
  revokeKey(input: UnkeyRevokeKeyInput): Promise<Record<string, never>>;
  deleteKey(input: UnkeyDeleteKeyInput): Promise<Record<string, never>>;
}

export interface UnkeyClientOptions {
  rootKey?: string;
  apiId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class UnkeyAPIError<TData = unknown> extends Error {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly data: TData | undefined;

  constructor(message: string, options: { status: number; requestId?: string; data?: TData }) {
    super(message);
    this.name = "UnkeyAPIError";
    this.status = options.status;
    this.requestId = options.requestId;
    this.data = options.data;
  }
}

export function createUnkeyClient(options: UnkeyClientOptions = {}): UnkeyClient {
  return new UnkeyHttpClient(options);
}

class UnkeyHttpClient implements UnkeyClient {
  private readonly rootKey: string | undefined;
  private readonly apiId: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: UnkeyClientOptions) {
    this.rootKey = options.rootKey ?? process.env.UNKEY_ROOT_KEY ?? undefined;
    this.apiId = options.apiId ?? process.env.UNKEY_API_ID ?? undefined;
    this.baseUrl = options.baseUrl ?? process.env.UNKEY_BASE_URL ?? DEFAULT_UNKEY_BASE_URL;
    this.fetchImpl = options.fetch ?? fetch;
  }

  createKey(input: UnkeyCreateKeyInput): Promise<UnkeyCreateKeyResult> {
    const apiId = input.apiId ?? this.apiId;
    if (!apiId) {
      throw new Error("Unkey createKey requires UNKEY_API_ID, options.apiId, or input.apiId.");
    }

    return this.request<UnkeyCreateKeyResult>("keys.createKey", {
      ...input,
      apiId,
    });
  }

  verifyKey(input: UnkeyVerifyKeyInput): Promise<UnkeyVerifyKeyResult> {
    return this.request<UnkeyVerifyKeyResult>("keys.verifyKey", input);
  }

  updateKey(input: UnkeyUpdateKeyInput): Promise<Record<string, never>> {
    return this.request<Record<string, never>>("keys.updateKey", input);
  }

  revokeKey(input: UnkeyRevokeKeyInput): Promise<Record<string, never>> {
    return this.updateKey({
      keyId: input.keyId,
      enabled: false,
    });
  }

  deleteKey(input: UnkeyDeleteKeyInput): Promise<Record<string, never>> {
    return this.request<Record<string, never>>("keys.deleteKey", input);
  }

  private async request<TData>(operation: string, body: unknown): Promise<TData> {
    if (!this.rootKey) {
      throw new Error("Unkey client requires UNKEY_ROOT_KEY or options.rootKey.");
    }

    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/v2/${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.rootKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await parseUnkeyResponse(response);
    if (!response.ok) {
      throw createUnkeyError(response, payload);
    }

    return ((payload as UnkeyAPIEnvelope<TData>).data ?? {}) as TData;
  }
}

async function parseUnkeyResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      message: text,
    };
  }
}

function createUnkeyError(response: Response, payload: unknown): UnkeyAPIError {
  const data = isRecord(payload) ? payload : undefined;
  const error = isRecord(data?.error) ? data.error : undefined;
  const message =
    getString(error?.message) ||
    getString(data?.message) ||
    response.statusText ||
    "Unkey API request failed.";
  const requestId =
    getString(data?.requestId) ||
    (isRecord(data?.meta) ? getString(data.meta.requestId) : undefined);

  return new UnkeyAPIError(message, {
    status: response.status,
    requestId,
    data,
  });
}

export interface UnkeyIntegrationPaths {
  basePath?: string;
  create?: string;
  verify?: string;
  update?: string;
  revoke?: string;
  deleteKey?: string;
}

interface ResolvedUnkeyPaths {
  create: string;
  verify: string;
  update: string;
  revoke: string;
  deleteKey: string;
}

export interface UnkeyProtectionOptions {
  matcher?: string | string[];
  headers?: string | string[];
  permissions?: string;
  tags?: string[] | ((request: Request, context: FarmIntegrationHandlerContext) => string[]);
  contextKey?: string;
  exposeToPage?: boolean;
  onVerified?: (
    request: Request,
    context: FarmIntegrationHandlerContext,
    result: UnkeyVerifyKeyResult,
  ) => Promise<Response | void> | Response | void;
  onDenied?: (
    request: Request,
    context: FarmIntegrationHandlerContext,
    result: UnkeyVerifyKeyResult | { valid: false; code: "MISSING_KEY" | "VERIFY_ERROR" },
  ) => Promise<Response | void> | Response | void;
}

export type UnkeyIntegrationInstance = UnkeyClient;

export interface UnkeyIntegrationInput extends UnkeyClientOptions {
  /** Existing Unkey-compatible client. Preferred over the legacy `client` alias. */
  instance?: UnkeyIntegrationInstance;
  /** @deprecated Use `instance` instead. */
  client?: UnkeyClient;
  paths?: UnkeyIntegrationPaths;
  protectedRoutes?: string | string[];
  protection?: UnkeyProtectionOptions;
  log?: FarmIntegrationLogger;
}

interface ResolvedUnkeyConfig {
  rootKey?: string;
  apiId?: string;
  baseUrl: string;
}

function createUnkeyApi(paths: ResolvedUnkeyPaths) {
  return createPathInferredClientApi(
    {
      path: paths.create,
      operation: clientApi.post<UnkeyCreateKeyInput, UnkeyCreateKeyResult, never, true>(
        paths.create,
        {
          responseFormat: "json",
          isServer: true,
        },
      ),
    },
    {
      path: paths.verify,
      operation: clientApi.post<UnkeyVerifyKeyInput, UnkeyVerifyKeyResult, never, true>(
        paths.verify,
        {
          responseFormat: "json",
          isServer: true,
        },
      ),
    },
    {
      path: paths.update,
      operation: clientApi.post<UnkeyUpdateKeyInput, Record<string, never>, never, true>(
        paths.update,
        {
          responseFormat: "json",
          isServer: true,
        },
      ),
    },
    {
      path: paths.revoke,
      operation: clientApi.post<UnkeyRevokeKeyInput, Record<string, never>, never, true>(
        paths.revoke,
        {
          responseFormat: "json",
          isServer: true,
        },
      ),
    },
    {
      path: paths.deleteKey,
      operation: clientApi.post<UnkeyDeleteKeyInput, Record<string, never>, never, true>(
        paths.deleteKey,
        {
          responseFormat: "json",
          isServer: true,
        },
      ),
    },
  );
}

export function unkey(input: UnkeyIntegrationInput = {}) {
  const config = resolveUnkeyConfig(input);
  const paths = resolveUnkeyPaths(input.paths);
  const hasInjectedClient = !!(input.instance ?? input.client);
  const client = input.instance ?? input.client ?? createUnkeyClient(config);
  const protection = input.protection;
  const protectedRoutes = input.protectedRoutes ?? protection?.matcher;

  return defineIntegration({
    category: "auth",
    type: "unkey",
    instance: {
      apiId: config.apiId,
      baseUrl: config.baseUrl,
      client,
    },
    api: createUnkeyApi(paths),
    config: integrationConfig<ResolvedUnkeyConfig>({
      label: "Unkey integration",
      env: {
        rootKey: "UNKEY_ROOT_KEY",
        apiId: "UNKEY_API_ID",
        baseUrl: "UNKEY_BASE_URL",
      },
      defaults: {
        baseUrl: DEFAULT_UNKEY_BASE_URL,
      },
      input: config,
      required: hasInjectedClient ? [] : ["rootKey"],
    }),
    log: input.log,
    middleware: protectedRoutes
      ? [
          {
            matcher: protectedRoutes,
            handler(request, context) {
              return verifyProtectedRequest(request, context, client, protection);
            },
          },
        ]
      : undefined,
    routes: [
      integrationRoute.post<
        typeof paths.create,
        UnkeyCreateKeyInput,
        UnkeyCreateKeyResult,
        never,
        true
      >(paths.create, {
        responseFormat: "json",
        isServer: true,
        async handler(request, context) {
          const blocked = ensureInternalServerCall(context);
          if (blocked) {
            return blocked;
          }

          const body = await readJsonBody<UnkeyCreateKeyInput>(request);
          if (!hasInjectedClient && !body.apiId && !config.apiId) {
            return Response.json(
              {
                error: "Unkey create key requires UNKEY_API_ID, options.apiId, or body.apiId.",
              },
              {
                status: 400,
              },
            );
          }

          return Response.json(
            await client.createKey({
              ...body,
              apiId: body.apiId ?? config.apiId,
            }),
          );
        },
      }),
      integrationRoute.post<
        typeof paths.verify,
        UnkeyVerifyKeyInput,
        UnkeyVerifyKeyResult,
        never,
        true
      >(paths.verify, {
        responseFormat: "json",
        isServer: true,
        async handler(request, context) {
          const blocked = ensureInternalServerCall(context);
          if (blocked) {
            return blocked;
          }

          return Response.json(
            await client.verifyKey(await readJsonBody<UnkeyVerifyKeyInput>(request)),
          );
        },
      }),
      integrationRoute.post<
        typeof paths.update,
        UnkeyUpdateKeyInput,
        Record<string, never>,
        never,
        true
      >(paths.update, {
        responseFormat: "json",
        isServer: true,
        async handler(request, context) {
          const blocked = ensureInternalServerCall(context);
          if (blocked) {
            return blocked;
          }

          return Response.json(
            await client.updateKey(await readJsonBody<UnkeyUpdateKeyInput>(request)),
          );
        },
      }),
      integrationRoute.post<
        typeof paths.revoke,
        UnkeyRevokeKeyInput,
        Record<string, never>,
        never,
        true
      >(paths.revoke, {
        responseFormat: "json",
        isServer: true,
        async handler(request, context) {
          const blocked = ensureInternalServerCall(context);
          if (blocked) {
            return blocked;
          }

          return Response.json(
            await client.revokeKey(await readJsonBody<UnkeyRevokeKeyInput>(request)),
          );
        },
      }),
      integrationRoute.post<
        typeof paths.deleteKey,
        UnkeyDeleteKeyInput,
        Record<string, never>,
        never,
        true
      >(paths.deleteKey, {
        responseFormat: "json",
        isServer: true,
        async handler(request, context) {
          const blocked = ensureInternalServerCall(context);
          if (blocked) {
            return blocked;
          }

          return Response.json(
            await client.deleteKey(await readJsonBody<UnkeyDeleteKeyInput>(request)),
          );
        },
      }),
    ],
  });
}

function resolveUnkeyConfig(input: UnkeyIntegrationInput): ResolvedUnkeyConfig {
  return {
    rootKey: input.rootKey ?? process.env.UNKEY_ROOT_KEY ?? undefined,
    apiId: input.apiId ?? process.env.UNKEY_API_ID ?? undefined,
    baseUrl: input.baseUrl ?? process.env.UNKEY_BASE_URL ?? DEFAULT_UNKEY_BASE_URL,
  };
}

function resolveUnkeyPaths(paths: UnkeyIntegrationPaths = {}): ResolvedUnkeyPaths {
  const basePath = normalizePath(paths.basePath ?? "/api/unkey");

  return {
    create: normalizePath(paths.create ?? `${basePath}/create`),
    verify: normalizePath(paths.verify ?? `${basePath}/verify`),
    update: normalizePath(paths.update ?? `${basePath}/update`),
    revoke: normalizePath(paths.revoke ?? `${basePath}/revoke`),
    deleteKey: normalizePath(paths.deleteKey ?? `${basePath}/delete-key`),
  };
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

async function readJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function ensureInternalServerCall(context: FarmIntegrationHandlerContext): Response | undefined {
  if (context.req.get(FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY) === true) {
    return undefined;
  }

  return Response.json(
    {
      error: "Not found",
    },
    {
      status: 404,
    },
  );
}

async function verifyProtectedRequest(
  request: Request,
  context: FarmIntegrationHandlerContext,
  client: UnkeyClient,
  options: UnkeyProtectionOptions = {},
): Promise<Response | void> {
  const key = getApiKeyFromRequest(request, options.headers);
  if (!key) {
    return (
      (await options.onDenied?.(request, context, {
        valid: false,
        code: "MISSING_KEY",
      })) ||
      Response.json(
        {
          error: "Missing API key",
          code: "MISSING_KEY",
        },
        {
          status: 401,
        },
      )
    );
  }

  try {
    const result = await client.verifyKey({
      key,
      permissions: options.permissions,
      tags: resolveProtectionTags(request, context, options.tags),
    });

    if (result.valid) {
      const contextKey = options.contextKey ?? "unkey";
      context.req.set(contextKey, result, {
        exposeToPage: options.exposeToPage,
      });
      context.req.set("apiKey", result, {
        exposeToPage: options.exposeToPage,
      });
      if (result.keyId) {
        context.req.set("apiKeyId", result.keyId, {
          exposeToPage: options.exposeToPage,
        });
      }
      if (result.identity?.externalId) {
        context.req.set("apiKeyOwnerId", result.identity.externalId, {
          exposeToPage: options.exposeToPage,
        });
      }

      return options.onVerified?.(request, context, result);
    }

    const override = await options.onDenied?.(request, context, result);
    if (override) {
      return override;
    }

    return Response.json(
      {
        error: "Invalid API key",
        code: result.code ?? "INVALID",
      },
      {
        status: result.code === "RATE_LIMITED" ? 429 : 401,
      },
    );
  } catch {
    const failure = {
      valid: false,
      code: "VERIFY_ERROR" as const,
    };
    const override = await options.onDenied?.(request, context, failure);
    if (override) {
      return override;
    }

    return Response.json(
      {
        error: "API key verification failed",
        code: failure.code,
      },
      {
        status: 401,
      },
    );
  }
}

function getApiKeyFromRequest(
  request: Request,
  headers: UnkeyProtectionOptions["headers"],
): string | undefined {
  const names = Array.isArray(headers)
    ? headers
    : headers
      ? [headers]
      : ["authorization", "x-api-key"];

  for (const name of names) {
    const value = request.headers.get(name);
    if (!value) {
      continue;
    }

    if (name.toLowerCase() === "authorization") {
      const match = value.match(/^Bearer\s+(.+)$/i);
      return (match?.[1] || value).trim();
    }

    return value.trim();
  }

  return undefined;
}

function resolveProtectionTags(
  request: Request,
  context: FarmIntegrationHandlerContext,
  tags: UnkeyProtectionOptions["tags"],
): string[] | undefined {
  return typeof tags === "function" ? tags(request, context) : tags;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
