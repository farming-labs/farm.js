import type { FarmSchemaField } from "./schema";

const SUPPORTED_PRIMARY_KEY_TYPES = new Set(["id", "uuid", "string", "integer"]);

export function assertSupportedPrimaryKeyField(location: string, field: FarmSchemaField): void {
  if (!field.primaryKey || SUPPORTED_PRIMARY_KEY_TYPES.has(field.type)) {
    return;
  }

  throw new Error(
    `Schema primary-key field "${location}" uses unsupported type "${field.type}". Supported types are id, uuid, string, and integer.`,
  );
}
