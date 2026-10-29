import type { FarmSchema, FarmSchemaField, FarmSchemaModel } from "@farm.js/core";

/** Operations a browser may perform on a model. */
export type SyncAccess = "read" | "write";

export type SyncModelConfig = {
  access?: SyncAccess;
  /**
   * Overrides the global row filter for this model. Every exposed model needs
   * a filter, here or the global one; `false` disables scoping and exposes
   * every row to every caller.
   */
  where?: SyncWhere | false;
  /** Persist this model's rows through the configured client cache adapter. */
  persist?: boolean;
};

export type SyncModelSetting = SyncAccess | false | SyncModelConfig;

export type SyncWhereContext = {
  context: Record<string, unknown>;
  request: Request;
  model: string;
  operation: SyncOperation;
};

export type SyncWhere = (
  context: SyncWhereContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type SyncOperation = "list" | "insert" | "update" | "delete";

/** Wire payload for a single sync operation. */
export type SyncRequestBody = {
  model: string;
  operation: SyncOperation;
  /** Row data for insert, `{ [key]: value, ...changes }` for update, `{ [key] }` for delete. */
  input?: Record<string, unknown>;
  /** Incremental cursor for list; the largest `updatedAt` the client already holds. */
  since?: string | null;
};

export type SyncListResult = {
  rows: Record<string, unknown>[];
  cursor: string | null;
  /** True when the server sent a full snapshot rather than a delta. */
  full: boolean;
  /**
   * Every key the caller can currently see, sent with a delta so the client can
   * drop rows that were deleted or left its scope since the last list.
   */
  keys?: unknown[];
};

export type SyncErrorCode =
  | "unknown_model"
  | "read_only"
  | "not_exposed"
  | "invalid_input"
  | "not_found"
  | "unauthorized"
  | "server_error";

export type SyncErrorBody = { error: { code: SyncErrorCode; message: string } };

/** Resolved, validated model metadata derived from the schema. */
export type ResolvedSyncModel = {
  name: string;
  model: FarmSchemaModel;
  /** Primary key field name. */
  key: string;
  access: SyncAccess;
  where: SyncWhere | false | undefined;
  persist: boolean;
  /** Field carrying the incremental cursor, when the schema declares one. */
  cursorField: string | undefined;
  fields: Record<string, FarmSchemaField>;
};

export function resolveSyncModels(
  schema: FarmSchema,
  models: Record<string, SyncModelSetting> | undefined,
  globalWhere: SyncWhere | false | undefined,
  defaultPersist: boolean,
): Map<string, ResolvedSyncModel> {
  const resolved = new Map<string, ResolvedSyncModel>();
  if (!models) return resolved;

  for (const [name, setting] of Object.entries(models)) {
    if (setting === false || setting === undefined) continue;

    const model = schema.models[name];
    if (!model) {
      throw new Error(
        `sync(): models.${name} is not in the schema. Available models: ${Object.keys(schema.models).join(", ") || "(none)"}.`,
      );
    }

    const config: SyncModelConfig =
      typeof setting === "string" ? { access: setting } : (setting ?? {});
    const access = config.access ?? "write";
    const where = config.where !== undefined ? config.where : globalWhere;

    // Reads are as sensitive as writes: an unfiltered read model hands every
    // row to any caller, signed in or not. Both need a filter or an explicit
    // `where: false`.
    if (where === undefined) {
      throw new Error(
        `sync(): models.${name} ${access === "write" ? "allows writes" : "is readable"} but no row filter is configured. ` +
          `Add a \`where\` to scope rows to the current session, or set \`where: false\` to expose every row to every caller deliberately.`,
      );
    }

    resolved.set(name, {
      name,
      model,
      key: resolvePrimaryKey(name, model),
      access,
      where,
      persist: config.persist ?? defaultPersist,
      cursorField: resolveCursorField(model),
      fields: model.fields,
    });
  }

  return resolved;
}

function resolvePrimaryKey(name: string, model: FarmSchemaModel): string {
  const keys = Object.entries(model.fields).filter(([, field]) => field.primaryKey);
  if (keys.length === 1) return keys[0]![0];
  if (keys.length === 0) {
    throw new Error(`sync(): model "${name}" needs a field marked \`primaryKey: true\`.`);
  }
  throw new Error(
    `sync(): model "${name}" has ${keys.length} primary key fields; sync requires exactly one.`,
  );
}

/** A `datetime` field named updatedAt enables incremental sync without extra config. */
function resolveCursorField(model: FarmSchemaModel): string | undefined {
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.type === "datetime" && (name === "updatedAt" || field.name === "updated_at")) {
      return name;
    }
  }
  return undefined;
}
