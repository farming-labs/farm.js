import type {
  ResolvedSyncModel,
  SyncErrorCode,
  SyncListResult,
  SyncOperation,
  SyncRequestBody,
} from "./types.js";

/** Minimal slice of the ORM client the sync runtime relies on. */
export type SyncOrmModelClient = {
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
  updateMany?(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<number>;
  delete?(args: { where: Record<string, unknown> }): Promise<number>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<number>;
};

export type SyncOrmClient = Record<string, SyncOrmModelClient>;

export class SyncOperationError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SyncOperationError";
  }
}

export type ExecuteSyncOptions = {
  body: SyncRequestBody;
  models: Map<string, ResolvedSyncModel>;
  orm: SyncOrmClient;
  request: Request;
  /** Context produced by the configured middleware chain. */
  context: Record<string, unknown>;
};

/**
 * Run one sync operation against the ORM with the model's row filter applied.
 *
 * The filter is merged into the query itself rather than checked against the
 * client's arguments, so a write aimed at a row outside the caller's scope
 * matches nothing instead of being trusted and rejected after the fact.
 */
export async function executeSyncOperation(
  options: ExecuteSyncOptions,
): Promise<SyncListResult | Record<string, unknown> | { deleted: number }> {
  const { body, models, orm, request, context } = options;
  const resolved = models.get(body.model);

  if (!resolved) {
    throw new SyncOperationError(
      "not_exposed",
      `Model "${body.model}" is not exposed to the browser.`,
      404,
    );
  }
  if (body.operation !== "list" && resolved.access !== "write") {
    throw new SyncOperationError(
      "read_only",
      `Model "${body.model}" is read-only from the browser.`,
      403,
    );
  }

  const client = orm[body.model];
  if (!client) {
    throw new SyncOperationError(
      "unknown_model",
      `Model "${body.model}" is missing from the ORM client.`,
      500,
    );
  }

  const scope = await resolveScope(resolved, { context, request, operation: body.operation });

  switch (body.operation) {
    case "list":
      return listRows(client, resolved, scope, body.since ?? null);
    case "insert":
      return insertRow(client, resolved, scope, body.input);
    case "update":
      return updateRow(client, resolved, scope, body.input);
    case "delete":
      return deleteRow(client, resolved, scope, body.input);
    default:
      throw new SyncOperationError("invalid_input", `Unknown operation "${body.operation}".`);
  }
}

async function resolveScope(
  resolved: ResolvedSyncModel,
  args: { context: Record<string, unknown>; request: Request; operation: SyncOperation },
): Promise<Record<string, unknown>> {
  if (!resolved.where) return {};
  const scope = await resolved.where({
    context: args.context,
    request: args.request,
    model: resolved.name,
    operation: args.operation,
  });
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new SyncOperationError(
      "server_error",
      `sync(): the row filter for "${resolved.name}" must return an object.`,
      500,
    );
  }
  return scope;
}

async function listRows(
  client: SyncOrmModelClient,
  resolved: ResolvedSyncModel,
  scope: Record<string, unknown>,
  since: string | null,
): Promise<SyncListResult> {
  const cursorField = resolved.cursorField;
  const incremental = Boolean(cursorField && since);
  const where: Record<string, unknown> = { ...scope };
  if (incremental) where[cursorField!] = { gt: new Date(since!) };

  const rows = await client.findMany({ where });
  return {
    rows,
    cursor: cursorField ? nextCursor(rows, cursorField, since) : null,
    full: !incremental,
  };
}

function nextCursor(
  rows: Record<string, unknown>[],
  cursorField: string,
  previous: string | null,
): string | null {
  let latest = previous ? new Date(previous).getTime() : 0;
  for (const row of rows) {
    const value = row[cursorField];
    const time =
      value instanceof Date
        ? value.getTime()
        : typeof value === "string" || typeof value === "number"
          ? new Date(value).getTime()
          : Number.NaN;
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return latest > 0 ? new Date(latest).toISOString() : previous;
}

async function insertRow(
  client: SyncOrmModelClient,
  resolved: ResolvedSyncModel,
  scope: Record<string, unknown>,
  input: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const data = sanitizeInput(resolved, input, { allowKey: true });
  // Scope columns are server-owned: a client-supplied value is discarded.
  return client.create({ data: { ...data, ...scope } });
}

async function updateRow(
  client: SyncOrmModelClient,
  resolved: ResolvedSyncModel,
  scope: Record<string, unknown>,
  input: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const data = sanitizeInput(resolved, input, { allowKey: false });
  const key = requireKey(resolved, input);
  const where = { ...scope, [resolved.key]: key };

  const updated = await client.update({ where, data });
  if (!updated) {
    throw new SyncOperationError(
      "not_found",
      `No ${resolved.name} row matched ${String(key)} within the current scope.`,
      404,
    );
  }
  return updated;
}

async function deleteRow(
  client: SyncOrmModelClient,
  resolved: ResolvedSyncModel,
  scope: Record<string, unknown>,
  input: Record<string, unknown> | undefined,
): Promise<{ deleted: number }> {
  const key = requireKey(resolved, input);
  const deleted = await client.deleteMany({ where: { ...scope, [resolved.key]: key } });
  if (deleted === 0) {
    throw new SyncOperationError(
      "not_found",
      `No ${resolved.name} row matched ${String(key)} within the current scope.`,
      404,
    );
  }
  return { deleted };
}

function requireKey(resolved: ResolvedSyncModel, input: Record<string, unknown> | undefined) {
  const key = input?.[resolved.key];
  if (key === undefined || key === null || key === "") {
    throw new SyncOperationError(
      "invalid_input",
      `${resolved.name}.${resolved.key} is required for this operation.`,
    );
  }
  return key;
}

/** Drop unknown columns so a client cannot write outside the declared schema. */
function sanitizeInput(
  resolved: ResolvedSyncModel,
  input: Record<string, unknown> | undefined,
  options: { allowKey: boolean },
): Record<string, unknown> {
  if (
    input !== undefined &&
    (typeof input !== "object" || input === null || Array.isArray(input))
  ) {
    throw new SyncOperationError("invalid_input", "Operation input must be an object.");
  }

  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input ?? {})) {
    if (!Object.hasOwn(resolved.fields, field)) continue;
    if (field === resolved.key && !options.allowKey) continue;
    data[field] = value;
  }
  return data;
}
