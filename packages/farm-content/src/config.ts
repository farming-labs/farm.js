import path from "node:path";
import { normalizeContentAssetFields } from "./assets.js";
import type {
  ContentAssetsInput,
  ContentCollection,
  ContentCollectionInput,
  ContentDataWithAssets,
  ContentFileSource,
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
  if (input.source?.kind !== "files") {
    throw new TypeError("Content collection source must come from files()");
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
