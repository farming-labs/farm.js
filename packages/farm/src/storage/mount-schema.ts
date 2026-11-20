import type { SchemaDefinition } from "@farming-labs/orm";

export function isMountSchema(value: unknown): value is SchemaDefinition {
  return (
    !!value &&
    typeof value === "object" &&
    "_tag" in value &&
    value._tag === "schema" &&
    "models" in value &&
    !!value.models &&
    typeof value.models === "object" &&
    !Array.isArray(value.models)
  );
}

export function isManagedMount(value: unknown): value is { managed: unknown } {
  return !!value && typeof value === "object" && "managed" in value && !!value.managed;
}

export function hasManagedMountSchema(value: unknown): boolean {
  return isManagedMount(value) && "schema" in value && isMountSchema(value.schema);
}
