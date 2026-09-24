import path from "node:path";
import { normalizeContentAssetFields } from "./assets.js";
import type {
  ContentAssetsInput,
  ContentCollection,
  ContentCollectionInput,
  ContentDataWithAssets,
  ContentFileSource,
  ContentRemoteDocument,
  ContentRemoteSource,
  ContentSchema,
  InferContentSchema,
} from "./types.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".mdx", ".json", ".yaml", ".yml"]);

export interface ContentFilesOptions {
  /** Ignore globs, evaluated relative to the Farm project root. */
  ignore?: string | readonly string[];
  /** Directory used to derive entry IDs. Defaults to the common static directory of all globs. */
  base?: string;
}

export function files(
  patterns: string | readonly string[],
  options: ContentFilesOptions = {},
): ContentFileSource {
  const normalizedPatterns = normalizePatterns(patterns, "patterns");
  const ignore = normalizePatterns(options.ignore ?? [], "ignore", true);
  const base = options.base === undefined ? undefined : normalizeRelativePath(options.base, "base");

  return Object.freeze({
    kind: "files" as const,
    patterns: Object.freeze(normalizedPatterns),
    ignore: Object.freeze(ignore),
    ...(base ? { base } : {}),
  });
}

export interface ContentRemoteOptions {
  /** Names the source in error messages, e.g. "sanity:posts". */
  name: string;
  fetch(): Promise<readonly ContentRemoteDocument[]>;
  /** Development re-fetch cadence in milliseconds. */
  refreshInterval?: number;
  create?: ContentRemoteSource["create"];
  update?: ContentRemoteSource["update"];
  delete?: ContentRemoteSource["delete"];
}

/** A content source that fetches documents instead of reading local files. */
export function remote(options: ContentRemoteOptions): ContentRemoteSource {
  if (!options || typeof options !== "object") {
    throw new TypeError("remote() requires an options object");
  }
  const name = typeof options.name === "string" ? options.name.trim() : "";
  if (!name) {
    throw new TypeError("remote() requires a non-empty name for error messages");
  }
  if (typeof options.fetch !== "function") {
    throw new TypeError(`remote(${JSON.stringify(name)}) requires a fetch() function`);
  }
  if (
    options.refreshInterval !== undefined &&
    (!Number.isFinite(options.refreshInterval) || options.refreshInterval < 100)
  ) {
    throw new TypeError(
      `remote(${JSON.stringify(name)}) refreshInterval must be at least 100 milliseconds`,
    );
  }

  for (const verb of ["create", "update", "delete"] as const) {
    if (options[verb] !== undefined && typeof options[verb] !== "function") {
      throw new TypeError(`remote(${JSON.stringify(name)}) ${verb} must be a function`);
    }
  }

  return Object.freeze({
    kind: "remote" as const,
    name,
    fetch: options.fetch,
    ...(options.refreshInterval !== undefined ? { refreshInterval: options.refreshInterval } : {}),
    ...(options.create ? { create: options.create } : {}),
    ...(options.update ? { update: options.update } : {}),
    ...(options.delete ? { delete: options.delete } : {}),
  });
}

export function collection<
  TSchema extends ContentSchema<any>,
  const TAssets extends ContentAssetsInput = undefined,
  TTransformed = ContentDataWithAssets<InferContentSchema<TSchema>, TAssets>,
>(
  input: ContentCollectionInput<TSchema, TTransformed, TAssets>,
): ContentCollection<TTransformed, InferContentSchema<TSchema>> {
  if (!input || typeof input !== "object") {
    throw new TypeError("Content collection must be an object");
  }
  if (input.source?.kind !== "files" && input.source?.kind !== "remote") {
    throw new TypeError("Content collection source must come from files() or remote()");
  }
  if (input.source.kind === "remote" && input.assets && input.assets !== true) {
    // Typed asset fields resolve files next to the entry on disk; a remote
    // document has no directory for them to live in.
    throw new TypeError(
      `Content collection with remote source ${JSON.stringify(input.source.name)} cannot declare asset fields`,
    );
  }
  if (!isContentSchema(input.schema)) {
    throw new TypeError(
      "Content collection schema must implement Standard Schema, parseAsync, or parse",
    );
  }
  if (input.transform !== undefined && typeof input.transform !== "function") {
    throw new TypeError("Content collection transform must be a function");
  }
  if (input.assets !== undefined && input.assets !== true && typeof input.assets !== "object") {
    throw new TypeError("Content collection assets must be true or an asset declaration object");
  }

  const assets =
    input.assets === true
      ? true
      : input.assets === undefined
        ? undefined
        : normalizeContentAssetFields(input.assets);

  return Object.freeze({
    source: input.source,
    schema: input.schema,
    ...(assets === undefined ? {} : { assets }),
    ...(input.transform ? { transform: input.transform } : {}),
  }) as unknown as ContentCollection<TTransformed, InferContentSchema<TSchema>>;
}

export function isSupportedContentFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isContentSchema(value: unknown): value is ContentSchema<any> {
  if (!value || typeof value !== "object") return false;
  const schema = value as ContentSchema<any>;
  return (
    typeof schema["~standard"]?.validate === "function" ||
    typeof schema.parseAsync === "function" ||
    typeof schema.parse === "function"
  );
}

function normalizePatterns(
  value: string | readonly string[],
  label: string,
  allowEmpty = false,
): string[] {
  const values = (Array.isArray(value) ? value : [value]).map((pattern) =>
    normalizeRelativePath(pattern, label),
  );
  if (!allowEmpty && values.length === 0) {
    throw new TypeError(`Content files ${label} must include at least one glob`);
  }
  return [...new Set(values)];
}

function normalizeRelativePath(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Content files ${label} must contain non-empty paths`);
  }
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new TypeError(`Content files ${label} must be relative to the Farm project root`);
  }
  if (normalized.split("/").includes("..")) {
    throw new TypeError(`Content files ${label} cannot leave the Farm project root`);
  }
  return normalized;
}
