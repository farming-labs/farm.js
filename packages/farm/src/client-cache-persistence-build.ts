import fs from "node:fs";
import path from "node:path";
import type { FarmCacheUserConfig } from "./cache";

const ADAPTER_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mts", "mjs"] as const;

export interface ResolvedClientCacheAdapterEntry {
  /** Absolute adapter module path with forward slashes, ready for codegen. */
  importPath: string;
  options: { version?: string; flushDelayMs?: number };
}

export interface ClientCachePersistenceEntryCode {
  imports: string;
  init: string;
}

/**
 * Resolve `cache.client.adapter` from configuration to an absolute module
 * path for the generated client entries. Fails the build with an actionable
 * error when the option is set but the module cannot be found.
 */
export function resolveFarmClientCacheAdapterEntry(
  root: string,
  cache: FarmCacheUserConfig | undefined,
): ResolvedClientCacheAdapterEntry | undefined {
  const client = cache?.client;
  const adapter = client?.adapter;
  if (adapter === undefined) return undefined;

  if (typeof adapter !== "string" || adapter.trim().length === 0) {
    throw new Error(
      'cache.client.adapter must be a module path string, for example "./src/cache-adapter".',
    );
  }

  const resolved = path.resolve(root, adapter);
  const found = resolveAdapterFile(resolved);
  if (!found) {
    throw new Error(
      `cache.client.adapter was not found: ${adapter} (resolved to ${resolved}). ` +
        "Point it at a client module whose default export is created with defineClientCacheAdapter().",
    );
  }

  const options: ResolvedClientCacheAdapterEntry["options"] = {};
  if (client?.version !== undefined) options.version = client.version;
  if (client?.flushDelayMs !== undefined) options.flushDelayMs = client.flushDelayMs;
  return { importPath: found.replace(/\\/g, "/"), options };
}

function resolveAdapterFile(resolved: string): string | undefined {
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  for (const extension of ADAPTER_EXTENSIONS) {
    const candidate = `${resolved}.${extension}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/**
 * Code fragments for the generated client entries: an import of the user's
 * adapter module and an init call that runs before hydration starts. Empty
 * strings when persistence is not configured, so entries stay unchanged.
 */
export function generateClientCachePersistenceCode(
  entry: ResolvedClientCacheAdapterEntry | undefined,
): ClientCachePersistenceEntryCode {
  if (!entry) return { imports: "", init: "" };

  return {
    imports: [
      `import * as __farmClientCacheAdapterModule from ${JSON.stringify(entry.importPath)};`,
      `import { initConfiguredClientCachePersistence as __farmInitClientCachePersistence } from "@farm.js/core/client";`,
    ].join("\n"),
    init: `__farmInitClientCachePersistence(__farmClientCacheAdapterModule, ${JSON.stringify(entry.options)});`,
  };
}
