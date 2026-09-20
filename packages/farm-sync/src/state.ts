import type { SyncDialect } from "./ddl.js";
import type { ResolvedSyncModel } from "./types.js";

/**
 * Attached to the plugin object so tooling can reach the resolved schema and
 * connection without re-reading configuration or duplicating validation.
 */
export const FARM_SYNC_PLUGIN_STATE = Symbol.for("farm.sync.plugin-state");

export type SyncPluginState = {
  models: Map<string, ResolvedSyncModel>;
  /** Resolves the configured database client, or the storage mount behind it. */
  resolveClient: () => Promise<unknown>;
  /** Set explicitly when the client's dialect cannot be detected. */
  dialect?: SyncDialect;
};
