import {
  findSchemaTableOwners,
  migrateSchemaTables,
  type FarmSchemaOwnerConfig,
} from "./schema-tables";
import { logger } from "./utils";

export interface SchemaDevNoticeOptions {
  /** Where the lines go. Defaults to Farm's logger. */
  log?: (message: string) => void;
  /** How long each plugin's look at its database may take. Default 5 seconds. */
  timeoutMs?: number;
}

/**
 * One line per plugin whose tables have changes `farm <plugin> migrate` would
 * apply, such as an upgrade the app has installed but not migrated. Read-only:
 * it plans exactly what migrate would print, and writes nothing.
 *
 * Meant to run in the background once the dev server is up: it never throws,
 * every plugin is bounded by a timeout, and a database it cannot reach is
 * left to `farm schema check` to report.
 */
export async function noticePendingSchemaChanges(
  config: FarmSchemaOwnerConfig & { plugins?: readonly unknown[] },
  options: SchemaDevNoticeOptions = {},
): Promise<string[]> {
  const lines: string[] = [];
  try {
    const owners = findSchemaTableOwners(config);
    const timeoutMs = options.timeoutMs ?? 5_000;
    for (const owner of owners) {
      try {
        const result = await withTimeout(
          migrateSchemaTables(owner, { config, log: () => {} }),
          timeoutMs,
        );
        if (result.planned === 0) continue;
        const { from, to } = result.upgrade ?? {};
        const name = from && to && from !== to ? `${owner.name} ${from} → ${to}` : owner.name;
        lines.push(
          `${name} has ${result.planned} change(s) to its tables that are not applied yet. Run \`farm ${owner.name} migrate\` to review them.`,
        );
      } catch {
        // Unreachable, unsupported, or slow: not the dev server's to report.
      }
    }
  } catch {
    // Never let a notice disturb the dev server.
  }
  const log = options.log ?? ((message: string) => logger.warn(message));
  for (const line of lines) log(line);
  return lines;
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
    // A slow database must not keep the process alive.
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
