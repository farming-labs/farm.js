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

export interface ContentEntry<TData = Record<string, unknown>> {
  /** Stable route-friendly identifier derived from the path relative to the source base. */
  readonly id: string;
  /** Schema-validated frontmatter or structured file data. */
  readonly data: TData;
  /** Markdown or MDX body. Structured JSON and YAML files use an empty string. */
  readonly body: string;
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
> {
  source: ContentFileSource;
  schema: TSchema;
  /** Change the final data value after validation, for example to add reading time. */
  transform?: (
    entry: ContentTransformContext<InferContentSchema<TSchema>>,
  ) => TTransformed | Promise<TTransformed>;
}

export interface ContentCollection<TData = unknown> {
  readonly source: ContentFileSource;
  readonly schema: ContentSchema<TData>;
  readonly transform?: (entry: ContentTransformContext<any>) => unknown | Promise<unknown>;
  /** @internal Used by generated Farm types. It has no runtime value. */
  readonly __farmContentEntry: ContentEntry<TData>;
}

export type ContentCollections = Record<string, ContentCollection<any>>;

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
