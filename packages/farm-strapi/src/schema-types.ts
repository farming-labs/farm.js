import type { API } from "@strapi/client";
import type { StrapiMediaAsset } from "./image.js";

declare global {
  namespace FarmJS {
    /** Extended by declarations generated from a local Strapi project. */
    interface StrapiContentTypes {}
  }
}

export interface StrapiContentTypeDefinition<
  TFields extends object = object,
  TPopulate extends Record<string, StrapiPopulateField> = Record<never, never>,
> {
  fields: TFields;
  populate: TPopulate;
}

export interface StrapiRelation<TResource extends string, TMany extends boolean = false> {
  kind: "relation";
  resource: TResource;
  many: TMany;
}

export interface StrapiMedia<TMany extends boolean = false> {
  kind: "media";
  many: TMany;
}

export interface StrapiComponent<TValue, TMany extends boolean = false> {
  kind: "component";
  value: TValue;
  many: TMany;
}

export interface StrapiDynamicZone<TValue> {
  kind: "dynamic-zone";
  value: TValue;
}

export interface StrapiUnknownPopulate<TMany extends boolean = false> {
  kind: "unknown";
  many: TMany;
}

export type StrapiPopulateField =
  | StrapiRelation<string, boolean>
  | StrapiMedia<boolean>
  | StrapiComponent<unknown, boolean>
  | StrapiDynamicZone<unknown>
  | StrapiUnknownPopulate<boolean>;

export interface StrapiGeneratedDocumentMetadata {
  id?: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  locale?: string | null;
}

type StrapiContentTypes = FarmJS.StrapiContentTypes;
export type StrapiGeneratedResource = Extract<keyof StrapiContentTypes, string>;

type DefinitionFor<TResource extends StrapiGeneratedResource> =
  StrapiContentTypes[TResource] extends StrapiContentTypeDefinition<infer TFields, infer TPopulate>
    ? StrapiContentTypeDefinition<TFields, TPopulate>
    : never;

type FieldsFor<TResource extends StrapiGeneratedResource> = DefinitionFor<TResource>["fields"];
type PopulateFor<TResource extends StrapiGeneratedResource> = DefinitionFor<TResource>["populate"];
type FieldName<TResource extends StrapiGeneratedResource> = Extract<
  keyof FieldsFor<TResource>,
  string
>;
type PopulateName<TResource extends StrapiGeneratedResource> = Extract<
  keyof PopulateFor<TResource>,
  string
>;
type PopulatePath<TResource extends StrapiGeneratedResource> =
  | PopulateName<TResource>
  | `${PopulateName<TResource>}.${string}`;

export type StrapiGeneratedQuery<TResource extends StrapiGeneratedResource> = Omit<
  API.BaseQueryParams,
  "fields" | "populate"
> & {
  fields?: readonly FieldName<TResource>[];
  populate?:
    | "*"
    | PopulatePath<TResource>
    | readonly PopulatePath<TResource>[]
    | Partial<Record<PopulateName<TResource>, unknown>>;
};

type SelectedFields<TResource extends StrapiGeneratedResource, TQuery> = TQuery extends {
  fields: infer TFields extends readonly FieldName<TResource>[];
}
  ? number extends TFields["length"]
    ? Partial<Pick<FieldsFor<TResource>, TFields[number]>>
    : Pick<FieldsFor<TResource>, TFields[number]>
  : "fields" extends keyof TQuery
    ? Partial<FieldsFor<TResource>>
    : FieldsFor<TResource>;

type IsDeepPopulate<TValue> = TValue extends { populate: unknown } ? true : false;

type RelationValue<TResource extends string> = TResource extends StrapiGeneratedResource
  ? StrapiGeneratedDocument<TResource>
  : unknown;

type PopulateValue<TField extends StrapiPopulateField, TPopulateValue> =
  IsDeepPopulate<TPopulateValue> extends true
    ? unknown
    : TField extends StrapiRelation<infer TResource, infer TMany>
      ? TMany extends true
        ? RelationValue<TResource>[]
        : RelationValue<TResource> | null
      : TField extends StrapiMedia<infer TMany>
        ? TMany extends true
          ? StrapiMediaAsset[]
          : StrapiMediaAsset | null
        : TField extends StrapiComponent<infer TValue, infer TMany>
          ? TMany extends true
            ? TValue[]
            : TValue | null
          : TField extends StrapiDynamicZone<infer TValue>
            ? TValue[]
            : TField extends StrapiUnknownPopulate<infer TMany>
              ? TMany extends true
                ? unknown[]
                : unknown
              : never;

type PopulateResult<
  TResource extends StrapiGeneratedResource,
  TName extends PopulateName<TResource>,
  TPopulateValue,
> = {
  [TKey in TName]: PopulateValue<PopulateFor<TResource>[TKey], TPopulateValue>;
};

type DefinitelyEnabled<TValue> = unknown extends TValue
  ? false
  : Extract<TValue, false | null | undefined> extends never
    ? true
    : false;

type PossibleObjectPopulateNames<
  TResource extends StrapiGeneratedResource,
  TPopulate extends object,
> = {
  [TName in keyof TPopulate]-?: [TPopulate[TName]] extends [false | null | undefined]
    ? never
    : TName;
}[keyof TPopulate] &
  PopulateName<TResource>;

type RequiredObjectPopulateNames<
  TResource extends StrapiGeneratedResource,
  TPopulate extends object,
> = {
  [TName in keyof TPopulate]-?: {} extends Pick<TPopulate, TName>
    ? never
    : DefinitelyEnabled<TPopulate[TName]> extends true
      ? TName
      : never;
}[keyof TPopulate] &
  PopulateName<TResource>;

type ObjectPopulateResult<TResource extends StrapiGeneratedResource, TPopulate extends object> = {
  [TName in RequiredObjectPopulateNames<TResource, TPopulate>]: PopulateValue<
    PopulateFor<TResource>[TName],
    TPopulate[TName]
  >;
} & Partial<{
  [TName in Exclude<
    PossibleObjectPopulateNames<TResource, TPopulate>,
    RequiredObjectPopulateNames<TResource, TPopulate>
  >]: PopulateValue<PopulateFor<TResource>[TName], TPopulate[TName]>;
}>;

type StringPopulateResult<
  TResource extends StrapiGeneratedResource,
  TPopulate extends PopulatePath<TResource>,
> = TPopulate extends unknown
  ? TPopulate extends PopulateName<TResource>
    ? PopulateResult<TResource, TPopulate, true>
    : TPopulate extends `${infer TName}.${string}`
      ? PopulateResult<TResource, Extract<TName, PopulateName<TResource>>, { populate: unknown }>
      : never
  : never;

type DeepArrayPopulateNames<
  TResource extends StrapiGeneratedResource,
  TPopulate extends readonly unknown[],
> = TPopulate[number] extends infer TPath
  ? TPath extends `${infer TName}.${string}`
    ? Extract<TName, PopulateName<TResource>>
    : never
  : never;

type ArrayPopulateResult<
  TResource extends StrapiGeneratedResource,
  TPopulate extends readonly unknown[],
> = PopulateResult<
  TResource,
  Exclude<
    Extract<TPopulate[number], PopulateName<TResource>>,
    DeepArrayPopulateNames<TResource, TPopulate>
  >,
  true
> &
  PopulateResult<TResource, DeepArrayPopulateNames<TResource, TPopulate>, { populate: unknown }>;

type PopulateSelection<TResource extends StrapiGeneratedResource, TPopulate> = TPopulate extends "*"
  ? PopulateResult<TResource, PopulateName<TResource>, true>
  : TPopulate extends PopulatePath<TResource>
    ? StringPopulateResult<TResource, TPopulate>
    : TPopulate extends readonly unknown[]
      ? number extends TPopulate["length"]
        ? Partial<ArrayPopulateResult<TResource, TPopulate>>
        : ArrayPopulateResult<TResource, TPopulate>
      : TPopulate extends object
        ? ObjectPopulateResult<TResource, TPopulate>
        : object;

type SelectedPopulate<TResource extends StrapiGeneratedResource, TQuery> = TQuery extends {
  populate: infer TPopulate;
}
  ? PopulateSelection<TResource, TPopulate>
  : "populate" extends keyof TQuery
    ? Partial<Record<PopulateName<TResource>, unknown>>
    : object;

export type StrapiGeneratedDocument<
  TResource extends StrapiGeneratedResource,
  TQuery = undefined,
> = StrapiGeneratedDocumentMetadata &
  SelectedFields<TResource, TQuery> &
  SelectedPopulate<TResource, TQuery>;

export interface GeneratedStrapiCollection<TResource extends StrapiGeneratedResource> {
  find(): Promise<StrapiGeneratedDocument<TResource>[]>;
  find<const TQuery extends StrapiGeneratedQuery<TResource>>(
    query: TQuery,
  ): Promise<StrapiGeneratedDocument<TResource, TQuery>[]>;
  findOne(documentId: string): Promise<StrapiGeneratedDocument<TResource>>;
  findOne<const TQuery extends StrapiGeneratedQuery<TResource>>(
    documentId: string,
    query: TQuery,
  ): Promise<StrapiGeneratedDocument<TResource, TQuery>>;
}
