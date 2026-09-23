import { declareSchemaTables, definePlugin } from "@farm.js/core";
import type { FarmSchema, FarmSqlDialect } from "@farm.js/core";
import { executeSyncOperation, SyncOperationError, type SyncOrmClient } from "./server.js";
import {
  resolveSyncModels,
  type ResolvedSyncModel,
  type SyncModelSetting,
  type SyncRequestBody,
  type SyncWhere,
} from "./types.js";

export type SyncPluginOptions = {
  /** Declarative data schema; see `defineSchema` from `@farm.js/core`. */
  schema: FarmSchema;
  /**
   * Name of a mount from `storage.mounts` in `farm.config.ts`. Models are read
   * and written through it, so an app with storage configured needs no
   * separate data-layer module.
   */
  storage?: string;
  /**
   * Your database, instead of `storage`. Pass a raw connection — a `pg` Pool, a
   * Drizzle or Prisma client, a D1 binding, a Mongo client, an unstorage
   * instance — and the orm runtime detects the driver and builds the model
   * client from the schema. An already-built orm client is used as-is.
   */
  client?: unknown | (() => unknown | Promise<unknown>);
  /** Row filter applied to every read and write, server side. */
  where?: SyncWhere | false;
  /** Which models the browser may read or write. Unlisted models are not exposed. */
  models: Record<string, SyncModelSetting>;
  /** Request middleware producing the context passed to `where`. */
  middleware?: readonly SyncMiddleware[];
  /** Endpoint the browser calls. */
  path?: string;
  /** Persist rows through the configured client cache adapter. */
  persist?: boolean;
  /**
   * Sql dialect for `farm sync migrate`. Only needed when the client's dialect
   * cannot be detected from its shape.
   */
  dialect?: FarmSqlDialect;
};

export type SyncMiddlewareContext = {
  request: Request;
  context: Record<string, unknown>;
};

export type SyncMiddleware = (
  ctx: SyncMiddlewareContext,
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;

export type { SyncOrmClient } from "./server.js";
export type {
  SyncAccess,
  SyncModelConfig,
  SyncModelSetting,
  SyncOperation,
  SyncWhere,
  SyncWhereContext,
} from "./types.js";

const DEFAULT_PATH = "/_farm/sync";

export function sync(options: SyncPluginOptions) {
  if (!options?.schema?.models) {
    throw new TypeError("sync() requires a `schema` created with defineSchema().");
  }

  const path = options.path ?? DEFAULT_PATH;
  const models = resolveSyncModels(
    options.schema,
    options.models,
    options.where,
    options.persist ?? true,
  );

  if (models.size === 0) {
    throw new Error("sync(): no models are exposed. Add at least one entry to `models`.");
  }

  let ormPromise: Promise<SyncOrmClient> | undefined;
  const resolveOrm = (): Promise<SyncOrmClient> => {
    ormPromise ??= resolveSyncClient(options, models);
    return ormPromise;
  };

  const plugin = definePlugin({
    name: "farm:sync",

    client: {
      // Serializable descriptor the browser runtime reads at startup.
      public: {
        path,
        models: Object.fromEntries(
          Array.from(models.values(), (model) => [
            model.name,
            {
              key: model.key,
              access: model.access,
              persist: model.persist,
              cursor: model.cursorField ?? null,
            },
          ]),
        ),
      },

      setup({ public: config }) {
        // Hand the descriptor to the runtime, which the app bundle imports.
        const scope = globalThis as { __FARM_SYNC_CONFIG__?: unknown; __FARM_SYNC__?: any };
        scope.__FARM_SYNC_CONFIG__ = config;
        scope.__FARM_SYNC__?.start?.(config);
      },
    },

    async beforeRequest(req, res) {
      const pathname = (req.url ?? "").split("?")[0];
      if (pathname !== path) return;

      if (req.method !== "POST") {
        sendJson(res, 405, { error: { code: "invalid_input", message: "Sync uses POST." } });
        return;
      }

      let body: SyncRequestBody;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          error: { code: "invalid_input", message: "Request body must be JSON." },
        });
        return;
      }
      if (!body || typeof body.model !== "string" || typeof body.operation !== "string") {
        sendJson(res, 400, {
          error: { code: "invalid_input", message: "Request body needs `model` and `operation`." },
        });
        return;
      }

      // The operation layer works in web-standard terms, so adapt once here.
      const request = toWebRequest(req, path);

      try {
        const context = await runMiddleware(options.middleware, request);
        const orm = await resolveOrm();
        const result = await executeSyncOperation({ body, models, orm, request, context });
        sendJson(res, 200, result);
      } catch (error) {
        if (error instanceof SyncOperationError) {
          sendJson(res, error.status, { error: { code: error.code, message: error.message } });
          return;
        }
        // Never leak an internal message to the browser.
        console.error("[farm:sync] operation failed", error);
        sendJson(res, 500, {
          error: { code: "server_error", message: "The sync operation failed." },
        });
      }
    },
  });

  // Declare the tables sync owns, so `farm sync migrate` can create them
  // without re-reading or re-validating configuration.
  return declareSchemaTables(plugin, {
    name: "sync",
    schema: options.schema,
    // A model the app has not opened to the browser is not sync's to create.
    models: Array.from(models.keys()),
    dialect: options.dialect,
    resolveClient: async () => {
      if (options.client) {
        return typeof options.client === "function"
          ? await (options.client as () => unknown | Promise<unknown>)()
          : options.client;
      }
      if (options.storage) {
        const { getStorage } = await import("@farm.js/core/storage");
        return getStorage(options.storage);
      }
      return undefined;
    },
  });
}

async function runMiddleware(
  middleware: readonly SyncMiddleware[] | undefined,
  request: Request,
): Promise<Record<string, unknown>> {
  let context: Record<string, unknown> = {};
  for (const entry of middleware ?? []) {
    const produced = await entry({ request, context });
    if (produced) context = { ...context, ...produced };
  }
  return context;
}

async function resolveSyncClient(
  options: SyncPluginOptions,
  models: Map<string, ResolvedSyncModel>,
): Promise<SyncOrmClient> {
  if (options.client) {
    const provided =
      typeof options.client === "function"
        ? await (options.client as () => unknown | Promise<unknown>)()
        : options.client;

    // Already model-shaped: an @farming-labs/orm client, or anything exposing
    // the same four methods. Use it directly.
    if (isModelClient(provided, models)) return provided;
    return buildOrm(options.schema, provided);
  }

  if (options.storage) {
    const mount = options.storage;
    // Imported lazily so the storage runtime never reaches a browser bundle.
    const { getStorage } = await import("@farm.js/core/storage");
    // A mount is an unstorage instance, which the orm runtime drives like any
    // other backend — so this is the same code path as a real database.
    return buildOrm(options.schema, getStorage(mount));
  }

  throw new Error(
    "sync(): no data source is configured. Set `storage` to a mount name from " +
      "storage.mounts in farm.config.ts, or pass `client` with your database connection.",
  );
}

/** Let the orm runtime detect the driver and build the model client. */
async function buildOrm(schema: FarmSchema, client: unknown): Promise<SyncOrmClient> {
  const { createIntegrationOrm } = await import("@farm.js/core");
  return (await createIntegrationOrm({ schema, client })) as unknown as SyncOrmClient;
}

/**
 * Write a JSON response using the Node primitives every Farm runtime provides.
 * The richer `res.status().json()` helpers are not present on every path.
 */
function sendJson(res: any, status: number, payload: unknown): void {
  if (typeof res.writeHead === "function") {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
    return;
  }
  res.statusCode = status;
  res.setHeader?.("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

/** True when every exposed model is already reachable with the methods sync calls. */
function isModelClient(
  value: unknown,
  models: Map<string, ResolvedSyncModel>,
): value is SyncOrmClient {
  if (!value || typeof value !== "object") return false;

  for (const name of models.keys()) {
    const model = (value as Record<string, unknown>)[name] as Record<string, unknown> | undefined;
    if (!model || typeof model !== "object") return false;
    if (typeof model.findMany !== "function" || typeof model.create !== "function") return false;
  }
  return true;
}

/** Read and parse a JSON body, tolerating a body already parsed upstream. */
async function readJsonBody(req: {
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>;
}): Promise<SyncRequestBody> {
  if (req.body && typeof req.body === "object") return req.body as SyncRequestBody;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) throw new SyntaxError("Empty body");
  return JSON.parse(raw);
}

/** Minimal web Request view over the Node request, for middleware and filters. */
function toWebRequest(
  req: { url?: string; method?: string; headers: Record<string, unknown> },
  path: string,
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const host = headers.get("host") ?? "localhost";
  const url = new URL(req.url ?? path, `http://${host}`);
  return new Request(url, { method: req.method ?? "POST", headers });
}

/** @internal Exposed for tests. */
export { resolveSyncModels, executeSyncOperation, SyncOperationError };
export type { ResolvedSyncModel };
