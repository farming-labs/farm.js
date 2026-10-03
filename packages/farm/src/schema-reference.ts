import type { FarmSchemaReference } from "./schema";

/** Keep the public reference default consistent across database-backed consumers. */
export function isDatabaseEnforcedReference(reference: FarmSchemaReference): boolean {
  return reference.enforced === undefined || reference.enforced === "db";
}
