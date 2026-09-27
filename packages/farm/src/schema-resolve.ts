import type { FarmSchema, FarmSchemaField, FarmSchemaModel } from "./schema";
import { assertSupportedPrimaryKeyField } from "./schema-primary-key";

export type ResolvedSchemaField = FarmSchemaField & {
  name: string;
};

export type ResolvedSchemaModel = Omit<FarmSchemaModel, "fields"> & {
  name: string;
  fields: Record<string, ResolvedSchemaField>;
};

/**
 * Resolve a schema's extensions, overrides, and name mappings.
 *
 * Table and column names fall back to the schema's own keys, which is what the
 * runtime ORM uses. Any other default would generate artifacts describing
 * tables the app cannot actually read.
 */
export function resolveSchemaModels(
  ownerKey: string,
  schema: FarmSchema,
): Record<string, ResolvedSchemaModel> {
  const models: Record<string, FarmSchemaModel> = Object.fromEntries(
    Object.entries(schema.models).map(([modelKey, model]) => [modelKey, cloneSchemaModel(model)]),
  );

  for (const [modelKey, extension] of Object.entries(schema.extend || {})) {
    const existing = models[modelKey];
    models[modelKey] = {
      ...(existing || { fields: {} }),
      ...(extension.name ? { name: extension.name } : {}),
      ...(extension.description ? { description: extension.description } : {}),
      fields: {
        ...existing?.fields,
        ...extension.fields,
      },
      constraints: [...(existing?.constraints || []), ...(extension.constraints || [])],
      meta: {
        ...existing?.meta,
        ...extension.meta,
      },
    };
  }

  for (const [modelKey, override] of Object.entries(schema.override || {})) {
    const existing = models[modelKey];

    if (!existing) {
      throw new Error(
        `Schema override for "${ownerKey}.${modelKey}" is invalid because that model does not exist.`,
      );
    }

    const fields = {
      ...existing.fields,
    };

    for (const [fieldKey, fieldOverride] of Object.entries(override.fields || {})) {
      const existingField = fields[fieldKey];

      if (!existingField && !fieldOverride.type) {
        throw new Error(
          `Schema override for "${ownerKey}.${modelKey}.${fieldKey}" is missing a field type.`,
        );
      }

      fields[fieldKey] = {
        ...existingField,
        ...fieldOverride,
      } as FarmSchemaField;
    }

    models[modelKey] = {
      ...existing,
      ...(override.name ? { name: override.name } : {}),
      ...(override.description ? { description: override.description } : {}),
      fields,
      constraints: override.constraints || existing.constraints,
      meta: {
        ...existing.meta,
        ...override.meta,
      },
    };
  }

  const resolvedModels: Record<string, ResolvedSchemaModel> = {};

  for (const [modelKey, model] of Object.entries(models)) {
    const modelName = model.name || modelKey;
    const fieldNames = new Set<string>();
    const resolvedFields: Record<string, ResolvedSchemaField> = {};

    for (const [fieldKey, field] of Object.entries(model.fields)) {
      const fieldName = field.name || fieldKey;
      assertSupportedPrimaryKeyField(`${ownerKey}.${modelKey}.${fieldKey}`, field);

      if (fieldNames.has(fieldName)) {
        throw new Error(
          `Schema model "${ownerKey}.${modelKey}" contains duplicate field name "${fieldName}".`,
        );
      }

      fieldNames.add(fieldName);
      resolvedFields[fieldKey] = {
        ...field,
        name: fieldName,
      };
    }

    const primaryKeyFields = Object.entries(resolvedFields)
      .filter(([, field]) => field.primaryKey)
      .map(([fieldKey]) => fieldKey);

    if (primaryKeyFields.length > 1) {
      throw new Error(
        `Schema model "${ownerKey}.${modelKey}" defines multiple primary-key fields: ${primaryKeyFields.map((fieldKey) => `"${fieldKey}"`).join(", ")}. Composite primary keys are not supported.`,
      );
    }

    for (const constraint of model.constraints || []) {
      for (const fieldKey of constraint.fields) {
        if (!Object.prototype.hasOwnProperty.call(resolvedFields, fieldKey)) {
          throw new Error(
            `Schema ${constraint.type} constraint on "${ownerKey}.${modelKey}" references missing field "${fieldKey}".`,
          );
        }
      }
    }

    resolvedModels[modelKey] = {
      ...model,
      name: modelName,
      fields: resolvedFields,
    };
  }

  for (const [modelKey, model] of Object.entries(resolvedModels)) {
    for (const [fieldKey, field] of Object.entries(model.fields)) {
      const reference = field.reference;
      if (!reference || !Object.prototype.hasOwnProperty.call(resolvedModels, reference.model)) {
        continue;
      }

      const referencedModel = resolvedModels[reference.model]!;
      if (!Object.prototype.hasOwnProperty.call(referencedModel.fields, reference.field)) {
        throw new Error(
          `Schema reference "${ownerKey}.${modelKey}.${fieldKey}" targets missing field "${ownerKey}.${reference.model}.${reference.field}".`,
        );
      }
    }
  }

  return resolvedModels;
}

function cloneSchemaModel(model: FarmSchemaModel): FarmSchemaModel {
  return {
    ...model,
    fields: Object.fromEntries(
      Object.entries(model.fields).map(([fieldKey, field]) => [fieldKey, { ...field }]),
    ),
    constraints: model.constraints ? [...model.constraints] : undefined,
    meta: model.meta ? { ...model.meta } : undefined,
  };
}
