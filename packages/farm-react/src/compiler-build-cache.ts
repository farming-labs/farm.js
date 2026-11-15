import { deserialize, serialize } from "node:v8";
import type { CompileReactModuleResult } from "./compiler";

interface CacheEntry {
  bytes: number;
  result: Promise<Buffer>;
}

// Bound retained payloads as well as entry overhead. In-flight compilations
// still belong to their callers; evicting one must not cancel that work.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 128;

/** @internal One production build, never a persistent or development cache. */
export class ReactCompilerBuildCache {
  private readonly entries = new Map<string, CacheEntry>();
  private bytes = 0;
  private disposed = false;

  constructor(
    private readonly maxBytes = MAX_BYTES,
    private readonly maxEntries = MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get retainedBytes(): number {
    return this.bytes;
  }

  dispose(): void {
    this.disposed = true;
    this.entries.clear();
    this.bytes = 0;
  }

  async compile(
    key: string,
    compile: () => Promise<CompileReactModuleResult>,
  ): Promise<CompileReactModuleResult> {
    const keyBytes = key.length * 2;
    if (this.disposed || keyBytes > this.maxBytes || this.maxEntries === 0) return compile();

    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    } else {
      const created: CacheEntry = {
        bytes: keyBytes,
        result: Promise.resolve()
          .then(compile)
          .then((result) => {
            // Source maps, diagnostic arrays and report counters must not be
            // mutable shared objects. V8 serialization also preserves undefined
            // source-map fields that a JSON round trip would silently remove.
            const serialized = serialize(result);
            if (this.entries.get(key) === created) {
              created.bytes += serialized.byteLength;
              this.bytes += serialized.byteLength;
              this.trim();
            }
            return serialized;
          })
          .catch((error: unknown) => {
            if (this.entries.get(key) === created) this.remove(key, created);
            throw error;
          }),
      };
      entry = created;
      this.entries.set(key, created);
      this.bytes += keyBytes;
      this.trim();
    }
    return deserialize(await entry.result) as CompileReactModuleResult;
  }

  private remove(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }

  private trim(): void {
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.remove(...oldest);
    }
  }
}

// Module identity separates compiler versions; the build's own lifetime
// separates concurrent builds, even when they use the same project root.
let buildCaches: WeakMap<AbortSignal, ReactCompilerBuildCache> | undefined;

export function getReactCompilerBuildCache(
  lifetime: AbortSignal,
): ReactCompilerBuildCache | undefined {
  if (lifetime.aborted) return undefined;
  buildCaches ??= new WeakMap();
  let cache = buildCaches.get(lifetime);
  if (!cache) {
    const created = new ReactCompilerBuildCache();
    cache = created;
    buildCaches.set(lifetime, cache);
    lifetime.addEventListener(
      "abort",
      () => {
        created.dispose();
        buildCaches?.delete(lifetime);
      },
      { once: true },
    );
  }
  return cache;
}
