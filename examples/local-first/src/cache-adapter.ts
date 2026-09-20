import { defineClientCacheAdapter, type PersistedEntry } from "@farm.js/core/client";

/**
 * Browser-side persistence for the client cache and synced rows.
 *
 * Five callbacks over any storage; this one uses localStorage for brevity.
 * Farm owns every policy decision above it: what may be written, when writes
 * flush, and how entries load on a warm start.
 */
const PREFIX = "farm-local-first:";

export default defineClientCacheAdapter({
  async keys() {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .map((key) => key.slice(PREFIX.length));
  },
  async get(key) {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as PersistedEntry) : null;
  },
  async set(key, entry) {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  },
  async delete(key) {
    localStorage.removeItem(PREFIX + key);
  },
  async clear() {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  },
});
