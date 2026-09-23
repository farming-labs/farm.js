import type { FarmPlugin } from "@farm.js/core/plugin";

export type ContentFileExtension = ".md" | ".mdx" | ".json" | ".yaml" | ".yml";

export interface ContentFileSource {
  readonly kind: "files";
  readonly patterns: readonly string[];
  readonly ignore: readonly string[];
  readonly base?: string;
}

export interface ContentSchemaIssue {
  readonly message: string;
  readonly path?: readonly unknown[];
}

export interface ContentSchemaResult<TOutput> {
  readonly value?: TOutput;
  readonly issues?: readonly ContentSchemaIssue[];
}

export interface ContentSchema<TOutput = unknown> {
  readonly "~standard"?: {
    readonly types?: { readonly output: TOutput };
    validate(value: unknown): ContentSchemaResult<TOutput> | Promise<ContentSchemaResult<TOutput>>;
  };
  readonly _output?: TOutput;
  parseAsync?(value: unknown): Promise<TOutput>;
  parse?(value: unknown): TOutput;
}

export type InferContentSchema<TSchema> = TSchema extends {
  readonly "~standard": { readonly types?: { readonly output: infer TOutput } };
}
  ? TOutput
  : TSchema extends { readonly _output?: infer TOutput }
    ? TOutput
    : TSchema extends ContentSchema<infer TOutput>
      ? TOutput
      : never;

export interface ContentFileAsset {
  readonly kind: "file";
  /** Relative path as written in the content source. */
  readonly source: string;
  /** Content-hashed public URL emitted by Farm. */
  readonly src: string;
  /** Original source filename. */
  readonly name: string;
  /** MIME type inferred from the source extension. */
  readonly type: string;
  /** Source size in bytes. */
  readonly bytes: number;
}

export interface ContentImageAsset {
  readonly kind: "image";
  /** Relative path as written in the content source. */
  readonly source: string;
  /** Content-hashed public URL emitted by Farm. */
  readonly src: string;
  /** Intrinsic source width in pixels. */
  readonly width: number;
  /** Intrinsic source height in pixels. */
  readonly height: number;
  /** Original source filename. */
  readonly name: string;
  /** MIME type detected from the image contents. */
  readonly type: string;
  /** Source size in bytes. */
  readonly bytes: number;
}

export type ContentAssetValue = ContentFileAsset | ContentImageAsset;

export interface ContentAssetField<
  TOutput,
  TInput extends string | readonly string[] = string | readonly string[],
> {
  /** @internal Runtime asset declaration consumed by the content loader. */
  readonly __farmContentAsset: {
    readonly kind: ContentAssetValue["kind"];
    readonly multiple: boolean;
    readonly optional: boolean;
    readonly defaultValue?: TInput;
  };
  /** Accept an omitted frontmatter value and return `undefined`. */
  optional(): ContentAssetField<TOutput | undefined, TInput>;
  /** Resolve this relative path when the frontmatter value is omitted. */
  default(value: TInput): ContentAssetField<Exclude<TOutput, undefined>, TInput>;
}

export type ContentAssetFields = {
  readonly [key: string]: ContentAssetField<any, any> | ContentAssetFields;
};

export type ContentAssetsInput = true | ContentAssetFields | undefined;

export type InferContentAssetFields<TFields> = TFields extends true | undefined
  ? {}
  : TFields extends ContentAssetFields
    ? {
        readonly [TKey in keyof TFields]: TFields[TKey] extends ContentAssetField<
          infer TOutput,
          any
        >
          ? TOutput
          : InferContentAssetFields<TFields[TKey]>;
      }
    : {};

export type ContentDataWithAssets<TData, TAssets> = TData & InferContentAssetFields<TAssets>;

export interface ContentEntry<TData = Record<string, unknown>> {
  /** Stable route-friendly identifier derived from the path relative to the source base. */
  readonly id: string;
  /** Schema-validated frontmatter or structured file data. */
  readonly data: TData;
  /** Markdown or MDX body. Structured JSON and YAML files use an empty string. */
  readonly body: string;
  /** Assets discovered in Markdown syntax, after validation and URL emission. */
  readonly bodyAssets: readonly ContentAssetValue[];
  /** Project-relative source path with POSIX separators. */
  readonly filePath: string;
}

export interface ContentTransformContext<TData> extends ContentEntry<TData> {
  /** Number of whitespace-delimited words in body. */
  readonly words: number;
}

export interface ContentCollectionInput<
  TSchema extends ContentSchema<any>,
  TTransformed = InferContentSchema<TSchema>,
  TAssets extends ContentAssetsInput = undefined,
> {
  source: ContentFileSource;
  schema: TSchema;
  /**
   * Process relative assets. `true` manages Markdown/MDX body references. An object also declares
   * typed frontmatter assets and merges their resolved values into `data`.
   */
  assets?: TAssets;
  /** Change the final data value after validation, for example to add reading time. */
  transform?: (
    entry: ContentTransformContext<ContentDataWithAssets<InferContentSchema<TSchema>, TAssets>>,
  ) => TTransformed | Promise<TTransformed>;
}

export interface ContentCollection<TData = unknown, TSchemaData = TData> {
  readonly source: ContentFileSource;
  readonly schema: ContentSchema<TSchemaData>;
  readonly assets?: true | ContentAssetFields;
  readonly transform?: (entry: ContentTransformContext<any>) => unknown | Promise<unknown>;
  /** @internal Used by generated Farm types. It has no runtime value. */
  readonly __farmContentEntry: ContentEntry<TData>;
}

export type ContentCollections = Record<string, ContentCollection<any, any>>;

export type InferContentCollectionEntry<TCollection> = TCollection extends {
  readonly __farmContentEntry: infer TEntry;
}
  ? TEntry
  : never;

export type InferContentRegistry<TCollections extends ContentCollections> = {
  readonly [TName in keyof TCollections]: InferContentCollectionEntry<TCollections[TName]>;
};

export interface ContentOptions<TCollections extends ContentCollections> {
  collections: TCollections;
}

export interface ContentPlugin<TCollections extends ContentCollections> extends FarmPlugin {
  /** @internal Read by Farm's generated type declarations. It has no runtime value. */
  readonly __farmContentRegistry: InferContentRegistry<TCollections>;
}

declare global {
  namespace FarmJS {
    interface ContentRegistry {}
  }
}

export type AppContentRegistry = FarmJS.ContentRegistry extends {
  collections: infer TCollections extends Record<string, ContentEntry<any>>;
}
  ? TCollections
  : Record<string, ContentEntry<Record<string, unknown>>>;

export type ContentCollectionName = Extract<keyof AppContentRegistry, string>;

export type AppContentEntry<TName extends ContentCollectionName> = AppContentRegistry[TName];
