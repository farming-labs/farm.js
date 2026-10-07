/**
 * Typed builders for common schema.org JSON-LD objects. Each returns a plain
 * object for `metadata.jsonLd`; spread the result to add more properties. Values
 * are passed through as written, so prefer absolute URLs.
 *
 * ```ts
 * import * as jsonLd from "@farm.js/core/json-ld";
 *
 * export const metadata = {
 *   jsonLd: jsonLd.breadcrumbList([{ name: "Docs", url: "https://acme.test/docs" }]),
 * };
 * ```
 */

const SCHEMA_CONTEXT = "https://schema.org";

/** A schema.org JSON-LD object with its `@context` and `@type`. */
export type JsonLd<TType extends string = string> = {
  "@context": typeof SCHEMA_CONTEXT;
  "@type": TType;
  [property: string]: unknown;
};

/** A person or organization: a plain name, or a name with a URL. */
export type JsonLdPersonInput =
  | string
  | { name: string; url?: string; type?: "Person" | "Organization" };

export interface JsonLdOfferInput {
  price: number | string;
  /** ISO 4217 currency code, for example `"USD"`. */
  priceCurrency: string;
  availability?:
    | "InStock"
    | "OutOfStock"
    | "PreOrder"
    | "BackOrder"
    | "Discontinued"
    | "LimitedAvailability"
    | "OnlineOnly"
    | "SoldOut";
  url?: string;
}

export interface JsonLdRatingInput {
  ratingValue: number | string;
  reviewCount?: number;
  ratingCount?: number;
  bestRating?: number | string;
}

export type ArticleJsonLdType = "Article" | "BlogPosting" | "NewsArticle" | "TechArticle";

export interface ArticleJsonLdInput {
  /** @default "Article" */
  type?: ArticleJsonLdType;
  headline: string;
  description?: string;
  url?: string;
  image?: string | string[];
  datePublished?: string | Date;
  dateModified?: string | Date;
  author?: JsonLdPersonInput | JsonLdPersonInput[];
  publisher?: { name: string; url?: string; logo?: string };
}

export function article(input: ArticleJsonLdInput): JsonLd<ArticleJsonLdType> {
  return thing(input.type ?? "Article", {
    headline: input.headline,
    description: input.description,
    url: input.url,
    image: input.image,
    datePublished: toDate(input.datePublished),
    dateModified: toDate(input.dateModified),
    author: Array.isArray(input.author)
      ? input.author.map((author) => person(author))
      : input.author && person(input.author),
    publisher: input.publisher && {
      "@type": "Organization",
      ...prune({
        name: input.publisher.name,
        url: input.publisher.url,
        logo: input.publisher.logo,
      }),
    },
  });
}

export interface BreadcrumbJsonLdItem {
  name: string;
  /** Omit for the current page, which may be the last item. */
  url?: string;
}

export function breadcrumbList(items: BreadcrumbJsonLdItem[]): JsonLd<"BreadcrumbList"> {
  return thing("BreadcrumbList", {
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      ...prune({ name: item.name, item: item.url }),
    })),
  });
}

export interface FaqJsonLdItem {
  question: string;
  answer: string;
}

export function faqPage(items: FaqJsonLdItem[]): JsonLd<"FAQPage"> {
  return thing("FAQPage", {
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  });
}

export interface ProductJsonLdInput {
  name: string;
  description?: string;
  url?: string;
  image?: string | string[];
  sku?: string;
  brand?: string;
  offers?: JsonLdOfferInput | JsonLdOfferInput[];
  aggregateRating?: JsonLdRatingInput;
}

export function product(input: ProductJsonLdInput): JsonLd<"Product"> {
  return thing("Product", {
    name: input.name,
    description: input.description,
    url: input.url,
    image: input.image,
    sku: input.sku,
    brand: input.brand && { "@type": "Brand", name: input.brand },
    offers: offers(input.offers),
    aggregateRating: rating(input.aggregateRating),
  });
}

export interface SoftwareApplicationJsonLdInput {
  name: string;
  description?: string;
  url?: string;
  image?: string | string[];
  /** For example `"DeveloperApplication"` or `"BusinessApplication"`. */
  applicationCategory?: string;
  operatingSystem?: string;
  softwareVersion?: string;
  offers?: JsonLdOfferInput | JsonLdOfferInput[];
  aggregateRating?: JsonLdRatingInput;
}

export function softwareApplication(
  input: SoftwareApplicationJsonLdInput,
): JsonLd<"SoftwareApplication"> {
  return thing("SoftwareApplication", {
    name: input.name,
    description: input.description,
    url: input.url,
    image: input.image,
    applicationCategory: input.applicationCategory,
    operatingSystem: input.operatingSystem,
    softwareVersion: input.softwareVersion,
    offers: offers(input.offers),
    aggregateRating: rating(input.aggregateRating),
  });
}

function thing<TType extends string>(
  type: TType,
  properties: Record<string, unknown>,
): JsonLd<TType> {
  return { "@context": SCHEMA_CONTEXT, "@type": type, ...prune(properties) };
}

function person(input: JsonLdPersonInput): Record<string, unknown> {
  if (typeof input === "string") return { "@type": "Person", name: input };
  return { "@type": input.type ?? "Person", ...prune({ name: input.name, url: input.url }) };
}

function offers(input: JsonLdOfferInput | JsonLdOfferInput[] | undefined): unknown {
  if (!input) return undefined;
  const offer = (value: JsonLdOfferInput) => ({
    "@type": "Offer",
    ...prune({
      price: value.price,
      priceCurrency: value.priceCurrency,
      availability: value.availability && `${SCHEMA_CONTEXT}/${value.availability}`,
      url: value.url,
    }),
  });
  return Array.isArray(input) ? input.map(offer) : offer(input);
}

function rating(input: JsonLdRatingInput | undefined): unknown {
  return input && { "@type": "AggregateRating", ...prune({ ...input }) };
}

function toDate(value: string | Date | undefined): string | undefined {
  if (!(value instanceof Date)) return value;
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

/** Drop unset fields so the output only carries what the caller provided. */
function prune(object: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }
  return result;
}
