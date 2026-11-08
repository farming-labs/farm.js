import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { isFarmIslandStrategy, type FarmIslandStrategy } from "../island";
import { FARM_VERSION } from "../version";

/** The client-boundary facts of one package entry graph. */
export interface PackageClientBoundaryResult {
  isClientComponent: boolean;
  shouldHydrate: boolean;
  islandStrategy: FarmIslandStrategy | null;
}

/** A path's identity when it was read: absolute path, size, mtimeMs, ctimeMs. */
type PathStamp = [path: string, size: number, mtimeMs: number, ctimeMs: number];

/**
 * One inspection of a package entry graph. It applies again to any visited set that contains every
 * file in `stops` and none in `files`: the inspection then reads the same files and stops at the
 * same places.
 */
interface CacheEntry {
  result: PackageClientBoundaryResult;
  /** Every file the inspection read. */
  files: string[];
  /** Files it reached that an earlier inspection had already visited. */
  stops: string[];
  /** Present when every path lies in `node_modules`, so the entry can be persisted. */
  stamps?: { files: PathStamp[]; directories: PathStamp[] };
}

interface StoredEntry {
  result: PackageClientBoundaryResult;
  /** Indexes into the stored path table. */
  files: number[];
  directories: number[];
  stops: string[];
}

interface StoredCache {
  schema: number;
  farm: string;
  paths: PathStamp[];
  entries: Record<string, StoredEntry[]>;
}

/** Bump when inspection semantics or this file's shape change. */
const SCHEMA_VERSION = 2;
const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

/**
 * Records what one package inspection read. Each file is stamped before it is read, so a write
 * racing the read invalidates the entry. Its directory is stamped too: the files present there
 * decide what the file's relative imports resolve to.
 */
export class PackageInspectionTrace {
  readonly files = new Set<string>();
  readonly stops = new Set<string>();
  private readonly fileStamps: Array<PathStamp | undefined> = [];
  private readonly directoryStamps = new Map<string, PathStamp | undefined>();

  visit(file: string): void {
    this.files.add(file);
    const directory = path.dirname(file);
    if (!this.directoryStamps.has(directory)) {
      this.directoryStamps.set(directory, stampPackagePath(directory, "directory"));
    }
    this.fileStamps.push(stampPackagePath(file, "file"));
  }

  /** The inspection reached `file` after it was already visited. */
  stop(file: string): void {
    if (!this.files.has(file)) this.stops.add(file);
  }

  toEntry(result: PackageClientBoundaryResult): CacheEntry {
    const entry: CacheEntry = {
      result: { ...result },
      files: Array.from(this.files),
      stops: Array.from(this.stops),
    };
    const files = this.fileStamps.filter((stamp) => stamp !== undefined);
    const directories = Array.from(this.directoryStamps.values()).filter(
      (stamp) => stamp !== undefined,
    );
    if (
      files.length === this.fileStamps.length &&
      directories.length === this.directoryStamps.size
    ) {
      entry.stamps = { files, directories };
    }
    return entry;
  }
}

function stampPackagePath(target: string, kind: "file" | "directory"): PathStamp | undefined {
  if (!`${target}${path.sep}`.includes(NODE_MODULES_SEGMENT)) return undefined;
  try {
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) return undefined;
    return [target, stat.size, stat.mtimeMs, stat.ctimeMs];
  } catch {
    return undefined;
  }
}

/**
 * Package inspections shared by every hydration plan computed during one production build. Within
 * a build package sources are a snapshot, so a result computed once is reused by the route
 * manifest and by each bundle environment. Results that read only `node_modules` are also
 * persisted, and reused by a later build only while every file and directory they read keeps its
 * size, mtime, and ctime.
 */
class PackageClientBoundaryCache {
  private readonly entries = new Map<string, CacheEntry[]>();
  private stored = new Map<string, StoredEntry[]>();
  private storedPaths: PathStamp[] = [];
  private readonly unchangedPaths = new Map<number, boolean>();
  private file: string | undefined;
  private dirty = false;

  load(file: string): void {
    this.file = file;
    const stored = readStoredCache(file);
    if (!stored) {
      this.dirty = true;
      return;
    }
    this.storedPaths = stored.paths;
    this.stored = new Map(Object.entries(stored.entries));
  }

  /** An inspection of `key` that applies to `visited`. */
  find(key: string, visited: ReadonlySet<string>): CacheEntry | undefined {
    let entries = this.entries.get(key);
    const stored = this.stored.get(key);
    if (stored) {
      this.stored.delete(key);
      entries ??= [];
      this.entries.set(key, entries);
      for (const entry of stored) {
        const restored = this.restore(entry);
        if (restored) entries.push(restored);
        else this.dirty = true;
      }
    }
    return entries?.find(
      (entry) =>
        entry.stops.every((file) => visited.has(file)) &&
        !entry.files.some((file) => visited.has(file)),
    );
  }

  add(key: string, entry: CacheEntry): void {
    const entries = this.entries.get(key);
    if (entries) entries.push(entry);
    else this.entries.set(key, [entry]);
    if (entry.stamps) this.dirty = true;
  }

  async persist(): Promise<void> {
    const file = this.file;
    // Stored entries this build never reached are dropped, so the file tracks the current graph.
    if (!file || (!this.dirty && this.stored.size === 0)) return;
    const paths: PathStamp[] = [];
    const pathIndexes = new Map<string, number>();
    const indexOf = (stamp: PathStamp) => {
      let index = pathIndexes.get(stamp[0]);
      if (index === undefined) {
        index = paths.push(stamp) - 1;
        pathIndexes.set(stamp[0], index);
      }
      return index;
    };
    const entries: Record<string, StoredEntry[]> = {};
    for (const [key, variants] of this.entries) {
      const persisted = variants.flatMap(({ result, stops, stamps }) =>
        stamps
          ? [
              {
                result,
                files: stamps.files.map(indexOf),
                directories: stamps.directories.map(indexOf),
                stops,
              },
            ]
          : [],
      );
      if (persisted.length > 0) entries[key] = persisted;
    }
    const contents = JSON.stringify({
      schema: SCHEMA_VERSION,
      farm: FARM_VERSION,
      paths,
      entries,
    } satisfies StoredCache);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(temporary, contents);
      await fs.promises.rename(temporary, file);
    } catch {
      // The cache only saves work; a build that cannot write it is still correct.
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
    }
  }

  private restore(entry: StoredEntry): CacheEntry | undefined {
    const files = this.restoreStamps(entry.files, "file");
    const directories = this.restoreStamps(entry.directories, "directory");
    if (!files || !directories) return undefined;
    return {
      result: entry.result,
      files: files.map(([file]) => file),
      stops: entry.stops,
      stamps: { files, directories },
    };
  }

  private restoreStamps(indexes: number[], kind: "file" | "directory"): PathStamp[] | undefined {
    const stamps: PathStamp[] = [];
    for (const index of indexes) {
      const stamp = this.storedPaths[index]!;
      let unchanged = this.unchangedPaths.get(index);
      if (unchanged === undefined) {
        const current = stampPackagePath(stamp[0], kind);
        unchanged =
          current !== undefined &&
          current[1] === stamp[1] &&
          current[2] === stamp[2] &&
          current[3] === stamp[3];
        this.unchangedPaths.set(index, unchanged);
      }
      if (!unchanged) return undefined;
      stamps.push(stamp);
    }
    return stamps;
  }
}

function readStoredCache(file: string): StoredCache | null {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(value) || value.schema !== SCHEMA_VERSION || value.farm !== FARM_VERSION) {
    return null;
  }
  const { paths, entries } = value;
  if (!Array.isArray(paths) || !paths.every(isPathStamp) || !isRecord(entries)) return null;
  const valid: Record<string, StoredEntry[]> = {};
  for (const [key, variants] of Object.entries(entries)) {
    if (!Array.isArray(variants)) continue;
    const usable = variants.filter((entry) => isStoredEntry(entry, paths.length));
    if (usable.length > 0) valid[key] = usable;
  }
  return { schema: SCHEMA_VERSION, farm: FARM_VERSION, paths, entries: valid };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathStamp(value: unknown): value is PathStamp {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    typeof value[0] === "string" &&
    path.isAbsolute(value[0]) &&
    value.slice(1).every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

function isPathIndexList(value: unknown, pathCount: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((index) => Number.isSafeInteger(index) && index >= 0 && index < pathCount)
  );
}

function isStoredEntry(value: unknown, pathCount: number): value is StoredEntry {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  const { isClientComponent, shouldHydrate, islandStrategy } = value.result;
  return (
    isPathIndexList(value.files, pathCount) &&
    isPathIndexList(value.directories, pathCount) &&
    Array.isArray(value.stops) &&
    value.stops.every((file) => typeof file === "string" && path.isAbsolute(file)) &&
    typeof isClientComponent === "boolean" &&
    typeof shouldHydrate === "boolean" &&
    (islandStrategy === null || isFarmIslandStrategy(islandStrategy)) &&
    Object.keys(value.result).length === 3
  );
}

// On globalThis because the CLI resolves config through core's CommonJS build and then runs the
// ESM build pipeline, so both copies must see the same build scope.
const STORAGE_KEY = Symbol.for("@farm.js/core/package-client-boundary-cache");

function getStorage(): AsyncLocalStorage<PackageClientBoundaryCache> {
  const runtime = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = runtime[STORAGE_KEY];
  if (existing instanceof AsyncLocalStorage) {
    return existing as AsyncLocalStorage<PackageClientBoundaryCache>;
  }
  const storage = new AsyncLocalStorage<PackageClientBoundaryCache>();
  runtime[STORAGE_KEY] = storage;
  return storage;
}

/** @internal The package inspection cache of the production build running in this context. */
export function getPackageClientBoundaryCache(): PackageClientBoundaryCache | undefined {
  return getStorage().getStore();
}

/**
 * @internal Share package client-boundary inspections across everything `operation` plans. Outside
 * such a scope, as in development, every inspection reads the package sources again.
 */
export async function withPackageClientBoundaryCache<T>(operation: () => Promise<T>): Promise<T> {
  const cache = new PackageClientBoundaryCache();
  try {
    return await getStorage().run(cache, operation);
  } finally {
    await cache.persist();
  }
}

/** @internal Persist the current build's package inspections to `file`, reusing those it holds. */
export function usePackageClientBoundaryCacheFile(file: string): void {
  getPackageClientBoundaryCache()?.load(file);
}
