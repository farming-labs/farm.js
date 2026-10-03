import type { FarmSchemaField } from "./schema";

/**
 * Reject a list field before a scalar-only schema target can silently change
 * its value shape. Targets that genuinely preserve arrays do not call this.
 */
export function assertNoSchemaListField(
  field: Pick<FarmSchemaField, "list">,
  fieldPath: string,
  target: string,
): void {
  if (!field.list) {
    return;
  }

  throw new Error(
    `Schema field "${fieldPath}" declares list: true, but ${target} does not support list fields. Use type: "json" for an array value or model the values in a related table.`,
  );
}
