import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";
import type {
  ContentAssetField,
  ContentAssetFields,
  ContentFileAsset,
  ContentImageAsset,
} from "./types.js";

export interface ContentAssetImport {
  readonly token: string;
  readonly filePath: string;
}

export interface ContentAssetContext {
  readonly root: string;
  readonly collectionName: string;
  readonly sourceFile: string;
  readonly sourceFiles: Set<string>;
  readonly imports: Map<string, ContentAssetImport>;
}

type RuntimeAssetField = ContentAssetField<any, any>;

const IMAGE_FORMATS: Readonly<
  Record<string, { readonly detected: readonly string[]; readonly type: string }>
> = Object.freeze({
  ".avif": { detected: ["heif"], type: "image/avif" },
  ".bmp": { detected: ["bmp"], type: "image/bmp" },
  ".gif": { detected: ["gif"], type: "image/gif" },
  ".heic": { detected: ["heif"], type: "image/heic" },
  ".heif": { detected: ["heif"], type: "image/heif" },
  ".ico": { detected: ["ico"], type: "image/x-icon" },
  ".jpe": { detected: ["jpg"], type: "image/jpeg" },
  ".jpeg": { detected: ["jpg"], type: "image/jpeg" },
  ".jpg": { detected: ["jpg"], type: "image/jpeg" },
  ".png": { detected: ["png"], type: "image/png" },
  ".svg": { detected: ["svg"], type: "image/svg+xml" },
  ".tif": { detected: ["tiff"], type: "image/tiff" },
  ".tiff": { detected: ["tiff"], type: "image/tiff" },
  ".webp": { detected: ["webp"], type: "image/webp" },
});

const FILE_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".avif": "image/avif",
  ".css": "text/css",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".zip": "application/zip",
});

export const asset = Object.freeze({
  image: () => createAssetField<ContentImageAsset, string>("image", false),
  images: () => createAssetField<readonly ContentImageAsset[], readonly string[]>("image", true),
  file: () => createAssetField<ContentFileAsset, string>("file", false),
  files: () => createAssetField<readonly ContentFileAsset[], readonly string[]>("file", true),
});

export function normalizeContentAssetFields(input: unknown): ContentAssetFields {
  const ancestors = new Set<object>();

  function visit(value: unknown, fieldPath: string): ContentAssetFields {
    if (!isPlainObject(value)) {
      throw new TypeError(`Content assets ${fieldPath || "definition"} must be an object`);
    }
    if (ancestors.has(value)) {
      throw new TypeError("Content assets definition cannot contain circular references");
    }
    ancestors.add(value);
    try {
      const result: Record<string, RuntimeAssetField | ContentAssetFields> = Object.create(null);
      for (const key of Object.keys(value)) {
        if (!key.trim()) throw new TypeError("Content asset field names cannot be empty");
        const child = (value as Record<string, unknown>)[key];
        result[key] = isContentAssetField(child)
          ? child
          : visit(child, fieldPath ? `${fieldPath}.${key}` : key);
      }
      if (Object.keys(result).length === 0) {
        throw new TypeError(`Content assets ${fieldPath || "definition"} cannot be empty`);
      }
      return Object.freeze(result);
    } finally {
      ancestors.delete(value);
    }
  }

  return visit(input, "");
}

export function splitContentAssetInput(
  input: unknown,
  fields: ContentAssetFields,
): { schemaInput: unknown; assetInput: unknown } {
  if (!isPlainObject(input)) {
    throw new TypeError("frontmatter must be an object when typed assets are configured");
  }

  function split(
    value: Record<string, unknown> | undefined,
    declarations: ContentAssetFields,
  ): { schema: Record<string, unknown>; assets: Record<string, unknown> } {
    const schema = copyRecord(value);
    const assets: Record<string, unknown> = Object.create(null);

    for (const [key, declaration] of Object.entries(declarations)) {
      if (isContentAssetField(declaration)) {
        assets[key] = value?.[key];
        delete schema[key];
        continue;
      }

      const child = value?.[key];
      if (child !== undefined && !isPlainObject(child)) {
        assets[key] = child;
        delete schema[key];
        continue;
      }
      const nested = split(child as Record<string, unknown> | undefined, declaration);
      assets[key] = nested.assets;
      if (child !== undefined) {
        if (Object.keys(nested.schema).length > 0) schema[key] = nested.schema;
        else delete schema[key];
      }
    }

    return { schema, assets };
  }

  const splitValue = split(input, fields);
  return { schemaInput: splitValue.schema, assetInput: splitValue.assets };
}

export async function resolveContentAssetFields(
  fields: ContentAssetFields,
  input: unknown,
  context: ContentAssetContext,
): Promise<Record<string, unknown>> {
  if (!isPlainObject(input)) {
    throw assetError(context, [], "Expected frontmatter asset values to be an object");
  }

  async function visit(
    declarations: ContentAssetFields,
    values: Record<string, unknown>,
    fieldPath: string[],
  ): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, declaration] of Object.entries(declarations)) {
      const nextPath = [...fieldPath, key];
      const value = values[key];
      if (isContentAssetField(declaration)) {
        result[key] = await resolveDeclaredAsset(declaration, value, context, nextPath);
      } else {
        if (!isPlainObject(value)) throw assetError(context, nextPath, "Expected an object");
        result[key] = await visit(declaration, value, nextPath);
      }
    }
    return result;
  }

  return visit(fields, input, []);
}

export function mergeContentAssetData(
  data: unknown,
  assets: Record<string, unknown>,
  context: ContentAssetContext,
): Record<string, unknown> {
  if (!isPlainObject(data)) {
    throw assetError(
      context,
      [],
      "Schema output must be an object when typed assets are configured",
    );
  }

  function merge(
    value: Record<string, unknown>,
    additions: Record<string, unknown>,
    fieldPath: string[],
  ): Record<string, unknown> {
    const result = copyRecord(value);
    for (const [key, addition] of Object.entries(additions)) {
      const nextPath = [...fieldPath, key];
      if (isPlainObject(addition) && !isResolvedAsset(addition)) {
        const existing = result[key];
        if (existing !== undefined && !isPlainObject(existing)) {
          throw assetError(context, nextPath, "Conflicts with the schema output");
        }
        result[key] = merge(
          (existing as Record<string, unknown> | undefined) ?? {},
          addition,
          nextPath,
        );
      } else {
        if (Object.prototype.hasOwnProperty.call(result, key)) {
          throw assetError(
            context,
            nextPath,
            "Conflicts with the schema output; remove this asset field from schema",
          );
        }
        result[key] = addition;
      }
    }
    return result;
  }

  return merge(data, assets, []);
}

export async function resolveContentAsset(
  reference: string,
  expectedKind: "image" | "file",
  context: ContentAssetContext,
  diagnosticPath: readonly string[],
): Promise<ContentFileAsset | ContentImageAsset> {
  const parsed = parseRelativeAssetReference(reference, context, diagnosticPath);
  const sourceDirectory = path.dirname(path.resolve(context.root, context.sourceFile));
  const requestedPath = path.resolve(sourceDirectory, parsed.path);
  assertInsideRoot(requestedPath, path.resolve(context.root), context, diagnosticPath);
  context.sourceFiles.add(requestedPath);

  let actualPath: string;
  let fileStats;
  try {
    [actualPath, fileStats] = await Promise.all([realpath(requestedPath), stat(requestedPath)]);
  } catch (error) {
    throw assetError(
      context,
      diagnosticPath,
      `Asset ${JSON.stringify(reference)} does not exist`,
      error,
    );
  }
  const actualRoot = await realpath(context.root);
  assertInsideRoot(actualPath, actualRoot, context, diagnosticPath);
  context.sourceFiles.add(actualPath);
  if (!fileStats.isFile()) {
    throw assetError(context, diagnosticPath, `Asset ${JSON.stringify(reference)} is not a file`);
  }

  const bytes = await readFile(actualPath);
  const token = registerAssetImport(actualPath, actualRoot, context.imports);
  const common = {
    src: `${token}${parsed.suffix}`,
    source: reference,
    name: path.basename(actualPath),
    bytes: bytes.byteLength,
  } as const;

  if (expectedKind === "file") {
    return Object.freeze({
      kind: "file" as const,
      ...common,
      type: FILE_MIME_TYPES[path.extname(actualPath).toLowerCase()] ?? "application/octet-stream",
    });
  }

  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(bytes);
  } catch (error) {
    throw assetError(
      context,
      diagnosticPath,
      `Asset ${JSON.stringify(reference)} is not a supported image with intrinsic dimensions`,
      error,
    );
  }
  if (!dimensions.width || !dimensions.height || !dimensions.type) {
    throw assetError(
      context,
      diagnosticPath,
      `Asset ${JSON.stringify(reference)} does not have readable intrinsic dimensions`,
    );
  }

  const extension = path.extname(actualPath).toLowerCase();
  const format = IMAGE_FORMATS[extension];
  if (!format) {
    throw assetError(
      context,
      diagnosticPath,
      `Asset ${JSON.stringify(reference)} uses an unsupported image extension ${JSON.stringify(extension || "(none)")}`,
    );
  }
  if (!format.detected.includes(dimensions.type)) {
    throw assetError(
      context,
      diagnosticPath,
      `Asset ${JSON.stringify(reference)} has extension ${JSON.stringify(extension)} but contains a ${dimensions.type} image`,
    );
  }

  return Object.freeze({
    kind: "image" as const,
    ...common,
    type: format.type,
    width: dimensions.width,
    height: dimensions.height,
  });
}

export function isContentAssetField(value: unknown): value is ContentAssetField<any, any> {
  if (!value || typeof value !== "object" || !("__farmContentAsset" in value)) return false;
  const field = value as Partial<RuntimeAssetField>;
  const definition = field.__farmContentAsset;
  return Boolean(
    definition &&
    (definition.kind === "image" || definition.kind === "file") &&
    typeof definition.multiple === "boolean" &&
    typeof definition.optional === "boolean" &&
    typeof field.optional === "function" &&
    typeof field.default === "function",
  );
}

function createAssetField<TOutput, TInput extends string | readonly string[]>(
  kind: "image" | "file",
  multiple: boolean,
  options: { optional?: boolean; defaultValue?: TInput } = {},
): ContentAssetField<TOutput, TInput> {
  const definition = Object.freeze({
    kind,
    multiple,
    optional: options.optional === true,
    ...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue }),
  });
  return Object.freeze({
    __farmContentAsset: definition,
    optional: () =>
      createAssetField<TOutput | undefined, TInput>(kind, multiple, {
        ...options,
        optional: true,
      }),
    default: (value: TInput) => {
      assertAssetDefault(value, multiple);
      const defaultValue = Array.isArray(value) ? Object.freeze([...value]) : value;
      return createAssetField<Exclude<TOutput, undefined>, TInput>(kind, multiple, {
        optional: false,
        defaultValue: defaultValue as TInput,
      });
    },
  });
}

async function resolveDeclaredAsset(
  field: RuntimeAssetField,
  rawValue: unknown,
  context: ContentAssetContext,
  fieldPath: readonly string[],
): Promise<unknown> {
  const definition = field.__farmContentAsset;
  const value = rawValue === undefined ? definition.defaultValue : rawValue;
  if (value === undefined) {
    if (definition.optional) return undefined;
    throw assetError(context, fieldPath, "Required asset is missing");
  }

  if (definition.multiple) {
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw assetError(context, fieldPath, "Expected an array of relative asset paths");
    }
    return Promise.all(
      value.map((entry, index) =>
        resolveContentAsset(entry, definition.kind, context, [...fieldPath, String(index)]),
      ),
    );
  }

  if (typeof value !== "string" || !value.trim()) {
    throw assetError(context, fieldPath, "Expected a relative asset path");
  }
  return resolveContentAsset(value, definition.kind, context, fieldPath);
}

function parseRelativeAssetReference(
  reference: string,
  context: ContentAssetContext,
  fieldPath: readonly string[],
): { path: string; suffix: string } {
  const value = reference.trim();
  if (
    !value ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("#") ||
    value.startsWith("?") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
  ) {
    throw assetError(
      context,
      fieldPath,
      `Expected a relative asset path, received ${JSON.stringify(reference)}`,
    );
  }
  if (value.includes("\\")) {
    throw assetError(context, fieldPath, "Asset paths must use forward slashes");
  }
  const suffixIndex = value.search(/[?#]/);
  const rawPath = suffixIndex < 0 ? value : value.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? "" : value.slice(suffixIndex);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch (error) {
    throw assetError(
      context,
      fieldPath,
      `Asset path ${JSON.stringify(reference)} has invalid encoding`,
      error,
    );
  }
  if (!decodedPath || decodedPath.includes("\0")) {
    throw assetError(context, fieldPath, `Asset path ${JSON.stringify(reference)} is invalid`);
  }
  return { path: decodedPath, suffix };
}

function registerAssetImport(
  filePath: string,
  root: string,
  imports: Map<string, ContentAssetImport>,
): string {
  const normalized = path.relative(root, filePath).replace(/\\/g, "/");
  const token = `__FARM_CONTENT_ASSET_${createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 20)}__`;
  if (!imports.has(token)) imports.set(token, Object.freeze({ token, filePath }));
  return token;
}

function assertInsideRoot(
  filePath: string,
  root: string,
  context: ContentAssetContext,
  fieldPath: readonly string[],
): void {
  const relative = path.relative(root, filePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw assetError(context, fieldPath, "Asset path cannot leave the Farm project root");
  }
}

function assetError(
  context: ContentAssetContext,
  fieldPath: readonly string[],
  message: string,
  cause?: unknown,
): Error {
  const location = fieldPath.length ? `${fieldPath.join(".")}: ` : "";
  return new Error(
    `[farm:content] Collection ${JSON.stringify(context.collectionName)} rejected ${context.sourceFile}: ${location}${message}`,
    cause === undefined ? undefined : { cause },
  );
}

function assertAssetDefault(value: unknown, multiple: boolean): void {
  if (multiple) {
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw new TypeError("Content asset list defaults must contain relative path strings");
    }
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("Content asset defaults must be relative path strings");
  }
}

function copyRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  if (!value) return result;
  for (const key of Object.keys(value)) result[key] = value[key];
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isResolvedAsset(value: Record<string, unknown>): boolean {
  return (value.kind === "image" || value.kind === "file") && typeof value.src === "string";
}
