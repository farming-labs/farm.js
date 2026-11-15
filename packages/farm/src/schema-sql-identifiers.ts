import type { FarmSqlDialect } from "./schema-sql";

const POSTGRES_IDENTIFIER_BYTES = 63;

/**
 * Postgres silently truncates identifiers to 63 bytes, so two long index names
 * that share a prefix become one, and `CREATE INDEX IF NOT EXISTS` then skips
 * the second index. A name over the limit is cut at a character boundary and
 * given a short hash of the full name, which keeps it unique and stable across
 * runs. Names within the limit, and other dialects, are unchanged.
 */
export function fitSqlIndexName(dialect: FarmSqlDialect, name: string): string {
  if (dialect !== "postgres") return name;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(name);
  if (bytes.length <= POSTGRES_IDENTIFIER_BYTES) return name;

  // FNV-1a over the UTF-8 bytes: dependency-free and identical on every runtime.
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  const suffix = `_${(hash >>> 0).toString(16).padStart(8, "0")}`;

  let prefix = "";
  let length = 0;
  for (const character of name) {
    const size = encoder.encode(character).length;
    if (length + size > POSTGRES_IDENTIFIER_BYTES - suffix.length) break;
    prefix += character;
    length += size;
  }
  return prefix + suffix;
}
