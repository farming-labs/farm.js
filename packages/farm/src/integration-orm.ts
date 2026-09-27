import type {
  AnyFieldBuilder,
  AnyModelDefinition,
  FieldBuilder,
  JsonValue,
  ModelDefinition,
  OrmClient,
  SchemaDefinition,
  SchemaModels,
} from "@farming-labs/orm";
import type {
  FarmIntegrationSchema,
  FarmIntegrationSchemaField,
  FarmIntegrationSchemaModel,
} from "./integrations";
import { assertNoSchemaListField } from "./schema-capabilities";
import { assertSupportedPrimaryKeyField } from "./schema-primary-key";
import { isDatabaseEnforcedReference } from "./schema-reference";
import { resolveSchemaModels } from "./schema-resolve";
import { resolveStorageRuntimeClient } from "./storage";
import type { FarmStorageUserConfig } from "./storage/types";
import type { FarmConfig } from "./types";

type RuntimeClientFactory<TClient> = () => TClient | Promise<TClient>;

export type FarmIntegrationOrmSchema = SchemaDefinition<Record<string, AnyModelDefinition>>;

export type FarmIntegrationOrmClient<TSchema extends FarmIntegrationOrmSchema> = OrmClient<TSchema>;

type FarmIntegrationOrmFieldKind<TField extends FarmIntegrationSchemaField> = TField extends {
  primaryKey: true;
}
  ? TField["type"] extends "id" | "uuid" | "string" | "integer"
    ? "id"
    : never
  : TField["type"] extends "id" | "uuid" | "text"
    ? "string"
    : TField["type"] extends "number"
      ? "decimal"
      : Extract<TField["type"], "string" | "boolean" | "integer" | "datetime" | "json" | "enum">;

type FarmIntegrationOrmFieldNullable<TField extends FarmIntegrationSchemaField> = TField extends {
  nullable: true;
}
  ? true
  : TField extends { required: false }
    ? true
    : false;

type FarmIntegrationOrmEnumValue<TField extends FarmIntegrationSchemaField> = TField extends {
  values: readonly (infer TValue extends string)[];
}
  ? TValue
  : string;

type FarmIntegrationOrmFieldValue<TField extends FarmIntegrationSchemaField> =
  TField["type"] extends "id" | "uuid" | "string" | "text"
    ? string
    : TField["type"] extends "boolean"
      ? boolean
      : TField["type"] extends "integer"
        ? number
        : TField["type"] extends "number"
          ? string
          : TField["type"] extends "datetime"
            ? Date
            : TField["type"] extends "json"
              ? JsonValue
              : TField["type"] extends "enum"
                ? FarmIntegrationOrmEnumValue<TField>
                : never;

export type InferFarmIntegrationOrmField<TField extends FarmIntegrationSchemaField> = FieldBuilder<
  FarmIntegrationOrmFieldKind<TField>,
  FarmIntegrationOrmFieldNullable<TField>,
  FarmIntegrationOrmFieldValue<TField>
>;

type FarmIntegrationOrmModelShape = {
  fields: Record<string, unknown>;
};

export type InferFarmIntegrationOrmFields<TModel extends FarmIntegrationOrmModelShape> = {
  [TFieldKey in keyof TModel["fields"] & string]: InferFarmIntegrationOrmField<
    Extract<TModel["fields"][TFieldKey], FarmIntegrationSchemaField>
  >;
};

type ReplaceRecord<TBase, TReplacement> = Omit<TBase, keyof TReplacement> & TReplacement;

type SchemaExtensions<TSchema extends FarmIntegrationSchema> = NonNullable<TSchema["extend"]>;

type SchemaOverrides<TSchema extends FarmIntegrationSchema> = NonNullable<TSchema["override"]>;

type SchemaModelFields<TModel> = TModel extends { fields: infer TFields }
  ? TFields
  : TModel extends { fields?: infer TFields }
    ? NonNullable<TFields>
    : {};

type ExtendedSchemaModelFields<
  TSchema extends FarmIntegrationSchema,
  TModelKey extends PropertyKey,
> = ReplaceRecord<
  TModelKey extends keyof TSchema["models"] ? SchemaModelFields<TSchema["models"][TModelKey]> : {},
  TModelKey extends keyof SchemaExtensions<TSchema>
    ? SchemaModelFields<SchemaExtensions<TSchema>[TModelKey]>
    : {}
>;

type OverrideSchemaModelFields<
  TSchema extends FarmIntegrationSchema,
  TModelKey extends PropertyKey,
> = TModelKey extends keyof SchemaOverrides<TSchema>
  ? SchemaModelFields<SchemaOverrides<TSchema>[TModelKey]>
  : {};

type ResolvedSchemaModelFields<
  TSchema extends FarmIntegrationSchema,
  TModelKey extends PropertyKey,
  TExtendedFields = ExtendedSchemaModelFields<TSchema, TModelKey>,
  TOverrideFields = OverrideSchemaModelFields<TSchema, TModelKey>,
> = {
  [TFieldKey in
    | keyof TExtendedFields
    | keyof TOverrideFields]: TFieldKey extends keyof TOverrideFields
    ? TFieldKey extends keyof TExtendedFields
      ? ReplaceRecord<TExtendedFields[TFieldKey], TOverrideFields[TFieldKey]>
      : TOverrideFields[TFieldKey]
    : TFieldKey extends keyof TExtendedFields
      ? TExtendedFields[TFieldKey]
      : never;
};

type ResolvedFarmIntegrationSchemaModels<TSchema extends FarmIntegrationSchema> = {
  [TModelKey in (keyof TSchema["models"] | keyof SchemaExtensions<TSchema>) & string]: {
    fields: ResolvedSchemaModelFields<TSchema, TModelKey>;
  };
};

export type InferFarmIntegrationOrmSchema<TSchema extends FarmIntegrationSchema> =
  SchemaDefinition<{
    [TModelKey in keyof ResolvedFarmIntegrationSchemaModels<TSchema> & string]: ModelDefinition<
      InferFarmIntegrationOrmFields<
        Extract<
          ResolvedFarmIntegrationSchemaModels<TSchema>[TModelKey],
          FarmIntegrationOrmModelShape
        >
      >,
      {}
    >;
  }>;

export type InferFarmIntegrationOrmClient<TSchema extends FarmIntegrationSchema | undefined> =
  TSchema extends FarmIntegrationSchema ? OrmClient<InferFarmIntegrationOrmSchema<TSchema>> : never;

export interface CreateIntegrationOrmOptions<
  TClient = unknown,
  TSchema extends FarmIntegrationSchema = FarmIntegrationSchema,
> {
  schema: TSchema;
  config?: Pick<FarmConfig, "storage">;
  storage?: FarmStorageUserConfig;
  client?: TClient | RuntimeClientFactory<TClient>;
}

export async function createIntegrationOrm<
  TClient = unknown,
  TSchema extends FarmIntegrationSchema = FarmIntegrationSchema,
>(
  options: CreateIntegrationOrmOptions<TClient, TSchema>,
): Promise<InferFarmIntegrationOrmClient<TSchema>> {
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
  }) as Promise<InferFarmIntegrationOrmClient<TSchema>>;
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
  for (const [modelKey, modelSchema] of Object.entries(schema.models)) {
    for (const [fieldKey, fieldSchema] of Object.entries(modelSchema.fields)) {
      assertNoSchemaListField(
        fieldSchema,
        `${modelKey}.${fieldKey}`,
        "the Farm integration runtime ORM",
      );
    }
  }

  const orm = await import("@farming-labs/orm");
  const models: Record<string, AnyModelDefinition> = {};
  const resolvedModels = resolveSchemaModels("integration", schema);

  for (const [modelKey, modelSchema] of Object.entries(resolvedModels)) {
    models[modelKey] = orm.model({
      table: modelSchema.name ?? modelKey,
      fields: createOrmModelFields(orm, modelKey, modelSchema),
      constraints: createOrmModelConstraints(modelSchema),
      description: modelSchema.description,
    }) as AnyModelDefinition;
  }

  return orm.defineSchema(models) as FarmIntegrationOrmSchema;
}

function createOrmModelFields(
  orm: typeof import("@farming-labs/orm"),
  modelKey: string,
  modelSchema: FarmIntegrationSchemaModel,
): Record<string, AnyFieldBuilder> {
  return Object.fromEntries(
    Object.entries(modelSchema.fields).map(([fieldKey, fieldSchema]) => [
      fieldKey,
      createOrmField(orm, modelKey, fieldKey, fieldSchema),
    ]),
  );
}

function createOrmField(
  orm: typeof import("@farming-labs/orm"),
  modelKey: string,
  fieldKey: string,
  field: FarmIntegrationSchemaField,
): AnyFieldBuilder {
  assertSupportedPrimaryKeyField(`integration.${modelKey}.${fieldKey}`, field);
  let builder = createOrmFieldBuilder(orm, fieldKey, field) as AnyFieldBuilder;

  if (!field.primaryKey && field.unique) {
    builder = builder.unique();
  }

  if (!field.primaryKey && (field.nullable || field.required === false)) {
    builder = builder.nullable();
  }

  if (field.default !== undefined) {
    builder =
      field.type === "datetime" && field.default === "now"
        ? builder.defaultNow()
        : builder.default(field.default as never);
  }

  if (field.reference && isDatabaseEnforcedReference(field.reference)) {
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
  if (field.primaryKey) {
    if (field.type === "integer") {
      return orm.id({ type: "integer" });
    }
    if (field.type === "string") {
      return new orm.FieldBuilder({
        kind: "id",
        nullable: false,
        unique: true,
        idType: "string",
      });
    }
    return orm.id();
  }

  switch (field.type) {
    case "id":
    case "uuid":
      return orm.string();
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
