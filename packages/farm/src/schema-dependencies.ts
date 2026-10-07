import type { FarmSchema } from "./schema";
import { collectSchemaExtensions } from "./schema-extend";
import { resolveSchemaModels } from "./schema-resolve";
import { collectSchemaModels } from "./schema-sql";

type DependencyOwner = {
  name: string;
  schema: FarmSchema;
  models?: readonly string[];
  dependsOn?: readonly string[];
};

/**
 * Which owners need which, by owner name: what they declare in `dependsOn`,
 * plus what their schemas imply. A reference to, or columns added to, a
 * table another owner creates makes that owner a dependency. An owner whose
 * schema cannot be resolved contributes only what it declares.
 */
export function collectSchemaDependencies(
  owners: readonly DependencyOwner[],
): Map<string, Set<string>> {
  const names = new Set(owners.map((owner) => owner.name));
  const known = new Map<string, ReturnType<typeof resolveSchemaModels>>();
  const creators = new Map<string, string>();
  const claimedKeys = new Map<string, string>();
  for (const owner of owners) {
    try {
      known.set(owner.name, resolveSchemaModels(owner.name, owner.schema));
      for (const model of collectSchemaModels([[owner.name, owner.schema, owner.models]])) {
        creators.set(model.modelName.toLowerCase(), owner.name);
        claimedKeys.set(model.modelKey, owner.name);
      }
    } catch {
      // Reported by the check; it implies nothing here.
    }
  }

  // The table a reference points at, resolved the way the check resolves it:
  // the owner's own description first, then a model another owner creates.
  const referencedTable = (owner: string, model: string) => {
    const own = known.get(owner)?.[model];
    if (own && Object.prototype.hasOwnProperty.call(known.get(owner), model)) return own.name;
    const creator = claimedKeys.get(model);
    return (creator && known.get(creator)?.[model]?.name) || model;
  };

  const dependencies = new Map<string, Set<string>>();
  for (const owner of owners) {
    const needs = new Set(
      (owner.dependsOn ?? []).filter((name) => names.has(name) && name !== owner.name),
    );
    dependencies.set(owner.name, needs);
    const add = (table: string) => {
      const creator = creators.get(table.toLowerCase());
      if (creator && creator !== owner.name) needs.add(creator);
    };

    try {
      for (const model of collectSchemaModels([[owner.name, owner.schema, owner.models]])) {
        for (const field of Object.values(model.model.fields)) {
          if (field.reference) add(referencedTable(owner.name, field.reference.model));
        }
      }
      for (const extension of collectSchemaExtensions(owner.name, owner.schema, owner.models)) {
        add(extension.table);
      }
    } catch {
      // As above.
    }
  }
  return dependencies;
}

/**
 * Owners with their dependencies first, otherwise in the order given. When
 * owners only refer to each other, every one is still listed exactly once:
 * without foreign keys between them, either can be created first.
 */
export function orderSchemaOwners<TOwner extends DependencyOwner>(
  owners: readonly TOwner[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>> = collectSchemaDependencies(owners),
): TOwner[] {
  const byName = new Map(owners.map((owner) => [owner.name, owner]));
  const ordered: TOwner[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (owner: TOwner) => {
    if (state.has(owner.name)) return;
    state.set(owner.name, "visiting");
    for (const name of dependencies.get(owner.name) ?? []) {
      const dependency = byName.get(name);
      if (dependency && state.get(name) !== "visiting") visit(dependency);
    }
    state.set(owner.name, "done");
    ordered.push(owner);
  };
  for (const owner of owners) visit(owner);
  return ordered;
}
