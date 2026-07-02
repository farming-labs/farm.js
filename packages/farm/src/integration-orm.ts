import type {
  AnyFieldBuilder,
  AnyModelDefinition,
  OrmClient,
  SchemaDefinition,
  SchemaModels,
} from "@farming-labs/orm";
import type {
  FarmIntegrationSchema,
  FarmIntegrationSchemaField,
  FarmIntegrationSchemaModel,
} from "./integrations";
import { resolveStorageRuntimeClient } from "./storage";
import type { FarmStorageUserConfig } from "./storage/types";
import type { FarmConfig } from "./types";

type RuntimeClientFactory<TClient> = () => TClient | Promise<TClient>;

export type FarmIntegrationOrmSchema = SchemaDefinition<Record<string, AnyModelDefinition>>;

export type FarmIntegrationOrmClient<TSchema extends FarmIntegrationOrmSchema> = OrmClient<TSchema>;

export interface CreateIntegrationOrmOptions<TClient = unknown> {
  schema: FarmIntegrationSchema;
  config?: Pick<FarmConfig, "storage">;
  storage?: FarmStorageUserConfig;
  client?: TClient | RuntimeClientFactory<TClient>;
}

export async function createIntegrationOrm<TClient = unknown>(
  options: CreateIntegrationOrmOptions<TClient>,
): Promise<FarmIntegrationOrmClient<FarmIntegrationOrmSchema>> {
  const [schema, client] = await Promise.all([
    farmIntegrationSchemaToOrmSchema(options.schema),
    resolveIntegrationOrmRuntimeClient(options),
  ]);

  if (!client) {
    throw new Error(
      "Schema-backed integration storage requires a runtime client at farm.config storage.client.",
    );
  }

  const { createOrmFromRuntime } = await import("@farming-labs/orm-runtime");
  return createOrmFromRuntime({
    schema,
    client,
  }) as Promise<FarmIntegrationOrmClient<FarmIntegrationOrmSchema>>;
}

export async function resolveIntegrationOrmRuntimeClient<TClient = unknown>(
  options: Omit<CreateIntegrationOrmOptions<TClient>, "schema">,
): Promise<TClient | unknown | undefined> {
  if (options.client !== undefined) {
    return typeof options.client === "function"
      ? await (options.client as RuntimeClientFactory<TClient>)()
      : options.client;
  }

  return resolveStorageRuntimeClient(options.storage ?? options.config?.storage);
}

export async function farmIntegrationSchemaToOrmSchema(
  schema: FarmIntegrationSchema,
): Promise<FarmIntegrationOrmSchema> {
  const orm = await import("@farming-labs/orm");
  const models: Record<string, AnyModelDefinition> = {};

  for (const [modelKey, modelSchema] of Object.entries(schema.models)) {
    models[modelKey] = orm.model({
      table: modelSchema.name ?? modelKey,
      fields: createOrmModelFields(orm, modelSchema),
      constraints: createOrmModelConstraints(modelSchema),
      description: modelSchema.description,
    }) as AnyModelDefinition;
  }

  return orm.defineSchema(models) as FarmIntegrationOrmSchema;
}

function createOrmModelFields(
  orm: typeof import("@farming-labs/orm"),
  modelSchema: FarmIntegrationSchemaModel,
): Record<string, AnyFieldBuilder> {
  return Object.fromEntries(
    Object.entries(modelSchema.fields).map(([fieldKey, fieldSchema]) => [
      fieldKey,
      createOrmField(orm, fieldKey, fieldSchema),
    ]),
  );
}

function createOrmField(
  orm: typeof import("@farming-labs/orm"),
  fieldKey: string,
  field: FarmIntegrationSchemaField,
): AnyFieldBuilder {
  let builder = createOrmFieldBuilder(orm, fieldKey, field) as AnyFieldBuilder;

  if (field.unique) {
    builder = builder.unique();
  }

  if (field.nullable || field.required === false) {
    builder = builder.nullable();
  }

  if (field.default !== undefined) {
    builder =
      field.type === "datetime" && field.default === "now"
        ? builder.defaultNow()
        : builder.default(field.default as never);
  }

  if (field.reference) {
    builder = builder.references(`${field.reference.model}.${field.reference.field}`);
  }

  if (field.name && field.name !== fieldKey) {
    builder = builder.map(field.name);
  }

  if (field.description) {
    builder = builder.describe(field.description);
  }

  return builder;
}

function createOrmFieldBuilder(
  orm: typeof import("@farming-labs/orm"),
  fieldKey: string,
  field: FarmIntegrationSchemaField,
): AnyFieldBuilder {
  switch (field.type) {
    case "id":
    case "uuid":
      return orm.id();
    case "string":
    case "text":
      return orm.string();
    case "boolean":
      return orm.boolean();
    case "integer":
      return orm.integer();
    case "number":
      return orm.decimal();
    case "datetime":
      return orm.datetime();
    case "json":
      return orm.json();
    case "enum": {
      if (!field.values?.length) {
        throw new Error(`Integration schema enum field "${fieldKey}" must define values.`);
      }

      return orm.enumeration(field.values as readonly [string, ...string[]]);
    }
    default:
      throw new Error(
        `Unsupported integration schema field type "${field.type}" for "${fieldKey}".`,
      );
  }
}

function createOrmModelConstraints(modelSchema: FarmIntegrationSchemaModel) {
  const unique: Array<readonly [string, ...string[]]> = [];
  const indexes: Array<readonly [string, ...string[]]> = [];

  for (const constraint of modelSchema.constraints ?? []) {
    if (!constraint.fields.length) {
      continue;
    }

    const fields = constraint.fields as readonly [string, ...string[]];
    if (constraint.type === "unique") {
      unique.push(fields);
    } else {
      indexes.push(fields);
    }
  }

  return {
    unique,
    indexes,
  };
}

export type IntegrationOrmModelNames<TSchema extends FarmIntegrationOrmSchema> =
  keyof SchemaModels<TSchema> & string;
