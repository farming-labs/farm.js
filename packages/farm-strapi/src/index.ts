import { defineIntegration } from "@farm.js/core";
import { createStrapiClient } from "./client.js";
import {
  resolveStrapiConfig,
  strapiIntegrationConfig,
  type StrapiIntegrationInput,
} from "./config.js";
import { createStrapiWebhookRoute } from "./webhook.js";

export function strapi(input: StrapiIntegrationInput = {}) {
  const config = resolveStrapiConfig(input);

  if (!input.instance && !config.apiUrl) {
    throw new Error(
      "Strapi integration requires a Content API URL. Set STRAPI_API_URL, pass apiUrl to " +
        "strapi(), or supply an existing @strapi/client instance.",
    );
  }

  const routes =
    input.webhook && config.webhookSecret
      ? [createStrapiWebhookRoute({ ...input.webhook, secret: config.webhookSecret })]
      : [];

  return defineIntegration({
    category: "cms",
    type: "strapi",
    instance: createStrapiClient(config, input.instance),
    config: strapiIntegrationConfig(config, input),
    log: input.log,
    routes,
  });
}

export { createStrapiClient } from "./client.js";
export {
  DEFAULT_STRAPI_WEBHOOK_PATH,
  DEFAULT_STRAPI_WEBHOOK_SECRET_HEADER,
  resolveStrapiConfig,
} from "./config.js";
export type {
  ResolvedStrapiConfig,
  StrapiIntegrationInput,
  StrapiWebhookChange,
  StrapiWebhookOptions,
} from "./config.js";
export { getStrapiImageProps } from "./image.js";
export type {
  StrapiImageOptions,
  StrapiImageProps,
  StrapiMediaAsset,
  StrapiMediaFormat,
} from "./image.js";
export { createStrapiCollection } from "./query.js";
export type { StrapiDocument, StrapiQueryParams, TypedStrapiCollection } from "./query.js";
export type {
  GeneratedStrapiCollection,
  StrapiComponent,
  StrapiContentTypeDefinition,
  StrapiDynamicZone,
  StrapiGeneratedDocument,
  StrapiGeneratedDocumentMetadata,
  StrapiGeneratedQuery,
  StrapiGeneratedResource,
  StrapiMedia,
  StrapiPopulateField,
  StrapiRelation,
  StrapiUnknownPopulate,
} from "./schema-types.js";
export { applyStrapiWebhookChange, createStrapiWebhookRoute } from "./webhook.js";
export type { StrapiWebhookInvalidation, StrapiWebhookRouteOptions } from "./webhook.js";
