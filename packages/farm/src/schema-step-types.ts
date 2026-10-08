import type { FarmSchema } from "./schema";
import { resolveSchemaModels } from "./schema-resolve";
import type { FarmSqlDialect } from "./schema-sql";

// Kept apart from schema-steps.ts, which reads and writes databases, so
// definePlugin can validate steps without loading any of it.

/**
 * An ordered change a plugin release makes to its own tables that Farm will
 * not infer: a rename looks exactly like a removal plus an addition. Each step
 * runs once per database, in the order listed.
 *
 * Names are the plugin's own: `model` and `to` are keys in the current
 * schema, so the app's renames apply; `from` is the old name in the database.
 */
export type FarmSchemaMigrationStep = { id: string; description?: string } & (
  | { renameColumn: { model: string; from: string; to: string } }
  | { renameTable: { from: string; to: string } }
  /**
   * Deletes data, so it runs only with `--allow-destructive`, and only on a
   * column or table Farm recorded this plugin creating.
   */
  | { dropColumn: { model: string; column: string } }
  | { dropTable: { table: string } }
  | {
      /** Per dialect; a dialect without SQL cannot run the step. */
      sql: Partial<Record<FarmSqlDialect, string | readonly string[]>>;
      /**
       * Custom SQL runs after this release's new tables and columns exist, so
       * a backfill can fill them. Set `before` to run it with the renames.
       */
      before?: boolean;
    }
);

/** Throw, while the config loads, for a step list that cannot work. */
export function validateSchemaSteps(
  owner: string,
  schema: FarmSchema,
  steps: readonly FarmSchemaMigrationStep[] | undefined,
): void {
  if (steps === undefined) return;
  if (!Array.isArray(steps)) {
    throw new TypeError(`${owner}: \`migrations\` must be a list of steps.`);
  }
  const models = resolveSchemaModels(owner, schema);
  const ids = new Set<string>();
  for (const step of steps) {
    const where = `${owner} migration "${step?.id}"`;
    if (!step || typeof step.id !== "string" || step.id.trim() === "") {
      throw new TypeError(`${owner}: every migration step needs a non-empty \`id\`.`);
    }
    if (ids.has(step.id))
      throw new Error(`${owner}: two migration steps share the id "${step.id}".`);
    ids.add(step.id);
    const kinds = ["renameColumn", "renameTable", "dropColumn", "dropTable", "sql"].filter(
      (kind) => kind in step,
    );
    if (kinds.length !== 1) {
      throw new Error(
        `${where} must be exactly one of renameColumn, renameTable, dropColumn, dropTable, or sql.`,
      );
    }
    if ("renameColumn" in step) {
      const { model, from, to } = step.renameColumn;
      const target = Object.prototype.hasOwnProperty.call(models, model)
        ? models[model]
        : undefined;
      if (!target)
        throw new Error(`${where} renames a column of "${model}", which is not a model.`);
      if (!Object.prototype.hasOwnProperty.call(target.fields, to)) {
        throw new Error(`${where} renames to "${model}.${to}", which is not a field.`);
      }
      if (typeof from !== "string" || from.trim() === "") {
        throw new Error(`${where} needs the old column name in \`from\`.`);
      }
    } else if ("renameTable" in step) {
      const { from, to } = step.renameTable;
      if (!Object.prototype.hasOwnProperty.call(models, to)) {
        throw new Error(`${where} renames a table to "${to}", which is not a model.`);
      }
      if (typeof from !== "string" || from.trim() === "") {
        throw new Error(`${where} needs the old table name in \`from\`.`);
      }
    } else if ("dropColumn" in step) {
      const { model, column } = step.dropColumn;
      const target = Object.prototype.hasOwnProperty.call(models, model)
        ? models[model]
        : undefined;
      if (!target) {
        throw new Error(`${where} drops a column of "${model}", which is not a model.`);
      }
      if (typeof column !== "string" || column.trim() === "") {
        throw new Error(`${where} needs the column to drop in \`column\`.`);
      }
      // A step can only remove what this release no longer declares.
      const current = Object.entries(target.fields).find(
        ([key, field]) => key === column || field.name === column,
      );
      if (current) {
        throw new Error(`${where} drops "${model}.${column}", which is still in the schema.`);
      }
    } else if ("dropTable" in step) {
      const { table } = step.dropTable;
      if (typeof table !== "string" || table.trim() === "") {
        throw new Error(`${where} needs the table to drop in \`table\`.`);
      }
      const current = Object.entries(models).find(
        ([key, model]) => key === table || model.name === table,
      );
      if (current) {
        throw new Error(
          `${where} drops "${table}", which is still in the schema${current[1].external ? " as a table the plugin does not own" : ""}.`,
        );
      }
    } else {
      const sql = step.sql;
      const dialects = Object.keys(sql ?? {});
      if (!sql || typeof sql !== "object" || dialects.length === 0) {
        throw new Error(`${where} needs SQL for at least one of postgres, mysql, or sqlite.`);
      }
    }
  }
}
