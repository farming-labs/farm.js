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
      return listRows(client, resolved, scope, body.since, body.scope);
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

/** A row filter checked against the schema, with what a write may derive from it. */
type ResolvedScope = {
  where: Record<string, unknown>;
  /** Every field the filter names at any depth: never writable by the client. */
  fields: Set<string>;
  /** Values a new row must carry to satisfy the filter. */
  stamp: Record<string, unknown>;
  /** Why the filter cannot decide a new row's values, when it cannot. */
  notInsertable: string | undefined;
};

const UNSCOPED: ResolvedScope = {
  where: {},
  fields: new Set(),
  stamp: {},
  notInsertable: undefined,
};

// The orm's filter grammar; anything else is rejected rather than guessed at.
const FILTER_OPERATORS = new Set(["eq", "contains", "in", "not", "gt", "gte", "lt", "lte"]);

async function resolveScope(
  resolved: ResolvedSyncModel,
  args: { context: Record<string, unknown>; request: Request; operation: SyncOperation },
): Promise<ResolvedScope> {
  if (!resolved.where) return UNSCOPED;
  const where = await resolved.where({
    context: args.context,
    request: args.request,
    model: resolved.name,
    operation: args.operation,
  });
  if (!isPlainObject(where)) {
    throw scopeError(resolved, "must return an object");
  }
  const scope: ResolvedScope = { where, fields: new Set(), stamp: {}, notInsertable: undefined };
  walkScope(resolved, scope, where, true);
  return scope;
}

/**
 * Validate the filter and collect what writes need from it.
 *
 * Drivers drop `undefined` values and keys that are not fields, which turns a
 * filter into no filter at all, so both fail here instead. Only plain equality
 * reached through `AND` decides a new row's values; `OR`, `NOT`, and operators
 * leave it ambiguous, so such a filter cannot be used for inserts.
 */
function walkScope(
  resolved: ResolvedSyncModel,
  scope: ResolvedScope,
  node: Record<string, unknown>,
  conjunctive: boolean,
): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === "AND" || key === "OR") {
      if (!Array.isArray(value) || !value.every(isPlainObject)) {
        throw scopeError(resolved, `uses ${key} with something other than a list of filters`);
      }
      if (key === "OR") scope.notInsertable ??= "it uses OR";
      for (const clause of value) walkScope(resolved, scope, clause, conjunctive && key === "AND");
      continue;
    }
    if (key === "NOT") {
      if (!isPlainObject(value)) {
        throw scopeError(resolved, "uses NOT with something other than a filter");
      }
      scope.notInsertable ??= "it uses NOT";
      walkScope(resolved, scope, value, false);
      continue;
    }
    if (!Object.hasOwn(resolved.fields, key)) {
      throw scopeError(resolved, `names "${key}", which is not a field of the model`);
    }
    scope.fields.add(key);

    let equal: { value: unknown } | undefined;
    if (isPlainObject(value)) {
      const operators = Object.keys(value);
      if (operators.length === 0 || !operators.every((op) => FILTER_OPERATORS.has(op))) {
        throw scopeError(
          resolved,
          `gives "${key}" an object that is not a filter operator (${[...FILTER_OPERATORS].join(", ")})`,
        );
      }
      for (const op of operators) {
        const operand = value[op];
        if (operand === undefined || (Array.isArray(operand) && operand.includes(undefined))) {
          throw scopeError(resolved, `gives "${key}.${op}" an undefined value`);
        }
      }
      if (operators.length === 1 && operators[0] === "eq") equal = { value: value.eq };
      else scope.notInsertable ??= `"${key}" is not compared by equality`;
    } else if (value === undefined) {
      throw scopeError(resolved, `gives "${key}" an undefined value`);
    } else if (
      Array.isArray(value) ||
      (typeof value === "object" && value !== null && !(value instanceof Date))
    ) {
      throw scopeError(resolved, `gives "${key}" a value that is not a scalar or filter operator`);
    } else {
      equal = { value };
    }

    if (!equal || !conjunctive) continue;
    if (Object.hasOwn(scope.stamp, key) && !sameValue(scope.stamp[key], equal.value)) {
      scope.notInsertable ??= `it gives "${key}" two different values`;
      continue;
    }
    scope.stamp[key] = equal.value;
  }
}

function scopeError(resolved: ResolvedSyncModel, problem: string): SyncOperationError {
  return new SyncOperationError(
    "server_error",
    `sync(): the row filter for "${resolved.name}" ${problem}.`,
    500,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return Object.is(left, right);
}

async function listRows(
  client: SyncOrmModelClient,
  resolved: ResolvedSyncModel,
  scope: ResolvedScope,
  since: unknown,
  clientScope: unknown,
): Promise<SyncListResult> {
  const cursorField = resolved.cursorField;
  const sinceDate = parseSince(since);
  const fingerprint = await scopeFingerprint(resolved, scope);
  // A cursor kept under another scope (a previous account, an old org) says
  // nothing about this one: answer with a full snapshot so the client drops
  // what it holds instead of merging a delta into the previous caller's rows.
  const sameScope =
    clientScope === undefined || clientScope === null || clientScope === fingerprint;
  const incremental = Boolean(cursorField && sinceDate && sameScope);
  const where: Record<string, unknown> = { ...scope.where };
  // `gte`, not `gt`: the cursor has millisecond precision, so a row written in
  // the same millisecond as the cursor row but after the previous list would
  // otherwise never be sent. Resending the cursor row itself is harmless, the
  // client upserts by key.
  if (incremental) where[cursorField!] = { gte: sinceDate };

  const rows = await client.findMany({ where });
  if (!incremental) {
    return {
      rows,
      cursor: cursorField ? nextCursor(rows, cursorField, null) : null,
      full: true,
      scope: fingerprint,
    };
  }

  // A delta cannot carry deletions, so it also lists every key the caller can
  // still see. Read after the rows, so a row inserted in between is at worst
  // absent from `rows` (and picked up by the next delta), never pruned.
  const visible = await client.findMany({ where: scope.where, select: { [resolved.key]: true } });
  return {
    rows,
    cursor: nextCursor(rows, cursorField!, since as string),
    full: false,
    keys: visible.map((row) => row[resolved.key]),
    scope: fingerprint,
  };
}

/** Fingerprint of a model with `where: false`: the same for every caller. */
export const PUBLIC_SYNC_SCOPE = "public";

/**
 * Identifies the rows a caller can see without revealing the filter's values.
 * The browser stores it with persisted rows and only reuses rows saved under
 * the fingerprint the server reports for the current session, so a reload
 * after a sign-out never paints the previous account's rows.
 */
async function scopeFingerprint(
  resolved: ResolvedSyncModel,
  scope: ResolvedScope,
): Promise<string> {
  if (!resolved.where) return PUBLIC_SYNC_SCOPE;
  const bytes = new TextEncoder().encode(stableStringify([resolved.name, scope.where]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify({ $date: value.toISOString() });
  if (typeof value === "bigint") return JSON.stringify({ $bigint: value.toString() });
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A cursor the client echoes back; anything else is a malformed request. */
function parseSince(since: unknown): Date | null {
  if (since === undefined || since === null) return null;
  const date = typeof since === "string" ? new Date(since) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw new SyncOperationError("invalid_input", "`since` must be an ISO timestamp or null.");
  }
  return date;
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
  scope: ResolvedScope,
  input: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  if (scope.notInsertable) {
    throw scopeError(
      resolved,
      `cannot decide a new row's values because ${scope.notInsertable}. ` +
        "Inserts need a filter of plain equality conditions, optionally combined with AND",
    );
  }

  // Scope and cursor columns are server-owned: client-supplied values are
  // discarded so a caller cannot widen its scope or stall everyone's
  // incremental sync by writing a stale timestamp. The stamp covers every
  // field the filter names, so the row always lands inside the caller's scope.
  const data = { ...sanitizeInput(resolved, input, { allowKey: true }), ...scope.stamp };

  // The browser generates keys so an optimistic row is addressable immediately,
  // but a direct API call may omit one. Without this an id-less row is written
  // that no update or delete can ever target.
  if (data[resolved.key] === undefined || data[resolved.key] === null) {
    const generated = generateKey(resolved);
    if (generated === undefined) {
      throw new SyncOperationError(
        "invalid_input",
        `${resolved.name}.${resolved.key} is required: it has no generatable type.`,
      );
    }
    data[resolved.key] = generated;
  } else {
    requireScalarKey(resolved, data[resolved.key]);
  }

  return client.create({ data: { ...data, ...cursorStamp(resolved) } });
}

async function updateRow(
  client: SyncOrmModelClient,
  resolved: ResolvedSyncModel,
  scope: ResolvedScope,
  input: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const data = sanitizeInput(resolved, input, { allowKey: false });
  const key = requireKey(resolved, input);

  // Scope columns are server-owned on update just like on insert: a client
  // sending one must not move the row into another caller's scope. The row
  // already matches the filter and keeps every column it reads, so it still
  // matches afterwards, whatever the filter's shape.
  for (const field of scope.fields) {
    delete data[field];
  }

  const updated = await client.update({
    where: scopedKeyFilter(resolved, scope, key),
    data: { ...data, ...cursorStamp(resolved) },
  });
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
  scope: ResolvedScope,
  input: Record<string, unknown> | undefined,
): Promise<{ deleted: number }> {
  const key = requireKey(resolved, input);
  const deleted = await client.deleteMany({ where: scopedKeyFilter(resolved, scope, key) });
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
  return requireScalarKey(resolved, key);
}

/**
 * A key must address exactly one row. Objects are rejected because the orm
 * reads them as operator filters — `{ not: null }` as a delete key would
 * otherwise match every row in scope.
 */
function requireScalarKey(resolved: ResolvedSyncModel, key: unknown) {
  if (typeof key !== "string" && typeof key !== "number" && typeof key !== "boolean") {
    throw new SyncOperationError(
      "invalid_input",
      `${resolved.name}.${resolved.key} must be a single value.`,
    );
  }
  return key;
}

/**
 * Combine the row filter with the client's key without letting one overwrite
 * the other: when the filter itself scopes by the key column, a plain merge
 * would let the client's key replace the scope entirely.
 */
function scopedKeyFilter(
  resolved: ResolvedSyncModel,
  scope: ResolvedScope,
  key: unknown,
): Record<string, unknown> {
  if (Object.keys(scope.where).length === 0) return { [resolved.key]: key };
  return { AND: [scope.where, { [resolved.key]: key }] };
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
    if (field === resolved.cursorField) continue;
    data[field] = value;
  }
  return data;
}

/**
 * Value for the cursor column on a write.
 *
 * Drivers do not maintain this: the orm writes exactly the columns it is given.
 * Stamping it here keeps incremental sync working the same way on every
 * backend rather than depending on a database default or trigger.
 */
function cursorStamp(resolved: ResolvedSyncModel): Record<string, unknown> {
  if (!resolved.cursorField) return {};
  return { [resolved.cursorField]: new Date().toISOString() };
}

/** Generate a key for schema types that carry one; other types must be supplied. */
function generateKey(resolved: ResolvedSyncModel): string | undefined {
  const type = resolved.fields[resolved.key]?.type;
  if (type !== "uuid" && type !== "id" && type !== "string" && type !== "text") return undefined;

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
