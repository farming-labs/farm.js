import type { FarmSchemaExecutor } from "./schema-migrate";
import { columnTypeFamily, describeSchemaTable } from "./schema-migrate";
import type { FarmSchemaReference } from "./schema";
import { isDatabaseEnforcedReference } from "./schema-reference";
import { resolveSchemaModels } from "./schema-resolve";
import { collectSchemaModels, getSqlColumnType, type FarmSqlDialect } from "./schema-sql";
import type { FarmSchemaTablesDeclaration } from "./schema-owner";

/** A reference from one plugin's table to a table another plugin creates. */
export type FarmCrossOwnerReference = {
  /** The owner whose table holds the reference. */
  owner: string;
  modelKey: string;
  fieldKey: string;
  table: string;
  column: string;
  referencedOwner: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: NonNullable<FarmSchemaReference["onDelete"]>;
};

export type FarmCrossOwnerReferencePlan = {
  /** A foreign key can be created for these: same database, compatible key. */
  eligible: FarmCrossOwnerReference[];
  /** The referenced table does not exist here yet; migrate its owner first. */
  waiting: FarmCrossOwnerReference[];
  /** Never a foreign key, and why. These stay as they are today. */
  skipped: Array<{ reference: FarmCrossOwnerReference; reason: string }>;
};

/**
 * Which of an owner's references to other owners' tables can carry a real
 * foreign key. Only tables a Farm owner creates qualify, never the app's own:
 * a constraint on the app's table would change how the app deletes its rows.
 * The referenced table must be in this owner's database, the referenced
 * column must be its primary key or unique, and the column types must match.
 */
export async function planCrossOwnerReferences(
  owner: Pick<FarmSchemaTablesDeclaration, "name" | "schema" | "models">,
  others: readonly Pick<FarmSchemaTablesDeclaration, "name" | "schema" | "models">[],
  dialect: FarmSqlDialect,
  executor: FarmSchemaExecutor,
): Promise<FarmCrossOwnerReferencePlan> {
  const plan: FarmCrossOwnerReferencePlan = { eligible: [], waiting: [], skipped: [] };
  const own = resolveSchemaModels(owner.name, owner.schema);
  const creators = new Map<
    string,
    { owner: string; model: ReturnType<typeof collectSchemaModels>[number] }
  >();
  const byKey = new Map<string, ReturnType<typeof collectSchemaModels>[number]>();
  for (const other of others) {
    if (other.name === owner.name) continue;
    try {
      for (const model of collectSchemaModels([[other.name, other.schema, other.models]])) {
        creators.set(model.modelName.toLowerCase(), { owner: other.name, model });
        byKey.set(model.modelKey, model);
      }
    } catch {
      // An invalid schema is reported by the check; it offers no keys.
    }
  }

  for (const model of collectSchemaModels([[owner.name, owner.schema, owner.models]])) {
    for (const [fieldKey, field] of Object.entries(model.model.fields)) {
      const reference = field.reference;
      if (!reference || !isDatabaseEnforcedReference(reference)) continue;
      // Resolved the way the check resolves it: the owner's own description
      // first, then a model another owner creates.
      const described = Object.prototype.hasOwnProperty.call(own, reference.model)
        ? own[reference.model]!.name
        : byKey.get(reference.model)?.modelName;
      const creator = described ? creators.get(described.toLowerCase()) : undefined;
      if (!creator) continue; // The app's table, or nobody's: stays a comment.

      const target = Object.entries(creator.model.model.fields).find(
        ([key, candidate]) => key === reference.field || candidate.name === reference.field,
      )?.[1];
      const entry: FarmCrossOwnerReference = {
        owner: owner.name,
        modelKey: model.modelKey,
        fieldKey,
        table: model.modelName,
        column: field.name,
        referencedOwner: creator.owner,
        referencedTable: creator.model.modelName,
        referencedColumn: target?.name ?? reference.field,
        onDelete: reference.onDelete ?? "noAction",
      };

      if (!target || !(target.primaryKey || target.unique)) {
        plan.skipped.push({
          reference: entry,
          reason: `"${entry.referencedTable}.${entry.referencedColumn}" is not its primary key or unique.`,
        });
        continue;
      }
      const mine = columnTypeFamily(getSqlColumnType(field, dialect));
      const theirs = columnTypeFamily(getSqlColumnType(target, dialect));
      if (dialect !== "sqlite" && mine !== theirs) {
        plan.skipped.push({ reference: entry, reason: "the column types differ." });
        continue;
      }
      const table = await describeSchemaTable(executor, dialect, entry.referencedTable);
      if (!table) {
        plan.waiting.push(entry);
        continue;
      }
      const column = table.columns.find((candidate) =>
        dialect === "postgres"
          ? candidate.name === entry.referencedColumn
          : candidate.name.toLowerCase() === entry.referencedColumn.toLowerCase(),
      );
      if (!column) {
        plan.skipped.push({
          reference: entry,
          reason: `"${entry.referencedTable}" has no column "${entry.referencedColumn}".`,
        });
        continue;
      }
      plan.eligible.push(entry);
    }
  }
  return plan;
}

/** Whether the app allows foreign keys to be added to an owner's existing table. */
export function isForeignKeyAllowed(
  allowForeignKeys: Record<string, readonly string[]> | undefined,
  reference: Pick<FarmCrossOwnerReference, "owner" | "modelKey" | "table">,
): boolean {
  if (
    !allowForeignKeys ||
    !Object.prototype.hasOwnProperty.call(allowForeignKeys, reference.owner)
  ) {
    return false;
  }
  const allowed = allowForeignKeys[reference.owner] ?? [];
  return allowed.includes(reference.modelKey) || allowed.includes(reference.table);
}

/** The farm.config entry that allows it, for messages. */
export function describeForeignKeyApproval(
  reference: Pick<FarmCrossOwnerReference, "owner" | "modelKey">,
) {
  return `schema: { allowForeignKeys: { ${JSON.stringify(reference.owner)}: [${JSON.stringify(reference.modelKey)}] } }`;
}
