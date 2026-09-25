import { render, toPlainText } from "@react-email/render";
import {
  defineIntegration,
  describeIntegrationOriginRejection,
  integrationRoute,
  validateIntegrationRequestOrigin,
  type FarmIntegrationLogger,
} from "@farm.js/core";
import { integrationConfig, normalizeWebhookConfig } from "@farm.js/integration-utils";
import type { FarmWebhookConfig, FarmWebhookEvent } from "@farm.js/integration-utils/webhooks";
import {
  createResendClientApi,
  type EmailTemplate,
  type EmailTemplates,
  type ResendClientAPI,
  type ResendClientPathOptions,
  type ResendDefaultClientAPI,
  type ResendEmailScheduleInput,
  type ResendEmailScheduleResult,
  type ResendEmailPreviewInput,
  type ResendEmailPreviewResult,
  type ResendEmailSendInput,
  type ResendEmailSendResult,
  type ResendEmailTemplateInfo,
  type ResendWebhookResult,
  template,
} from "./client.js";
import { createElement } from "react";
import { emailSchedule, resolveEmailScheduleWhen } from "./schedule.js";
import { Resend as ResendSdk, type WebhookEventPayload } from "resend";

export type {
  EmailScheduleDelay,
  EmailScheduleWhen,
  EmailTemplate,
  EmailTemplates,
  ResendClientAPI,
  ResendClientPathOptions,
  ResendDefaultClientAPI,
  ResendEmailScheduleInput,
  ResendEmailScheduleResult,
  ResendEmailPreviewInput,
  ResendEmailPreviewResult,
  ResendEmailSendInput,
  ResendEmailSendResult,
  ResendEmailTemplateInfo,
  ResendWebhookResult,
} from "./client.js";
export type { WebhookEventPayload } from "resend";
export { createResendClientApi, resendClient, template } from "./client.js";
export { emailSchedule } from "./schedule.js";

export interface ResendWebhookEvent extends FarmWebhookEvent<
  "resend",
  WebhookEventPayload["type"],
  WebhookEventPayload["data"],
  WebhookEventPayload
> {}

export type ResendWebhookConfig = FarmWebhookConfig<ResendWebhookEvent>;
export type ResendIntegrationInstance = ResendSdk;

export interface ResendIntegrationDefaults {
  from?: string;
  replyTo?: string | string[];
}

/** Which mounted route an authorization decision is being made for. */
export interface ResendEmailAuthorizeContext {
  route: "send" | "schedule" | "preview";
}

/**
 * Decide whether a caller may use the mounted email routes. Return `true` to
 * allow, `false` for a generic 401, or a `Response` to answer the caller
 * directly (for example a redirect or a domain-specific error body).
 */
export type ResendEmailAuthorize = (
  request: Request,
  context: ResendEmailAuthorizeContext,
) => boolean | Response | Promise<boolean | Response>;

export interface ResendIntegrationInput<TTemplates extends EmailTemplates = EmailTemplates> {
  apiKey?: string;
  instance?: ResendIntegrationInstance;
  basePath?: string;
  defaults?: ResendIntegrationDefaults;
  templates: TTemplates;
  webhooks?: ResendWebhookConfig;
  log?: FarmIntegrationLogger;
  /**
   * Required to expose the send, schedule, and preview routes. These routes
   * spend the application's own Resend credits and send from its verified
   * domain, so they are never anonymously callable by default.
   */
  authorize?: ResendEmailAuthorize;
  /**
   * Serve the routes with no authorization at all. Only for an application
   * that already gates the base path in middleware or at the edge.
   */
  allowUnauthenticated?: boolean;
  /** Extra trusted origins, using the `serverActions.allowedOrigins` syntax. */
  allowedOrigins?: readonly string[];
}

interface ResolvedResendConfig {
  apiKey?: string;
  from?: string;
  replyTo?: string | string[];
  webhookSecret?: string;
}

function createResendApi<
  TTemplates extends EmailTemplates,
  const TInput extends ResendClientPathOptions = {},
>(input: TInput = {} as TInput): ResendClientAPI<TTemplates, TInput> {
  return createResendClientApi<TTemplates, TInput>(input);
}

const MISSING_EMAIL_AUTHORIZE_ERROR =
  "The email routes are not authorized. These routes spend your Resend credits and send " +
  "from your verified domain, so they refuse anonymous callers. Pass `authorize` to the " +
  "email integration, or set `allowUnauthenticated: true` if the base path is already " +
  "gated by your own middleware.";

/**
 * Gate a mounted email route.
 *
 * Two layers, because either alone is insufficient. The origin check stops a
 * cross-site page from spending the application's credits through a visitor's
 * session, but it cannot stop a visitor on the application's own origin from
 * calling the route directly. `authorize` is therefore the real gate, and the
 * route fails closed without it. Origin metadata is not required, so a
 * server-to-server caller that authenticates through `authorize` still works.
 */
async function guardEmailRoute(
  request: Request,
  route: "send" | "schedule" | "preview",
  input: {
    authorize?: ResendEmailAuthorize;
    allowUnauthenticated?: boolean;
    allowedOrigins?: readonly string[];
  },
): Promise<Response | null> {
  const origin = validateIntegrationRequestOrigin(request, {
    allowedOrigins: input.allowedOrigins,
    requireOriginMetadata: false,
  });
  if (!origin.ok) {
    return Response.json(
      { error: describeIntegrationOriginRejection(origin.reason) },
      { status: 403 },
    );
  }

  if (input.authorize) {
    const decision = await input.authorize(request, { route });
    if (decision instanceof Response) return decision;
    if (decision !== true) {
      return Response.json({ error: "Unauthorized email request." }, { status: 401 });
    }
    return null;
  }

  if (input.allowUnauthenticated === true) return null;

  return Response.json({ error: MISSING_EMAIL_AUTHORIZE_ERROR }, { status: 401 });
}

function normalizeBasePath(path: string | undefined) {
  if (!path) {
    return "/api/email";
  }

  return path.endsWith("/") ? path.slice(0, -1) : path;
}

async function resolveTemplateString<TData>(
  value: string | ((data: TData) => string | Promise<string>) | undefined,
  data: TData,
) {
  if (typeof value === "function") {
    return await value(data);
  }

  return value ?? null;
}

async function resolveReplyToValue<TData>(
  value:
    | string
    | string[]
    | ((data: TData) => string | string[] | Promise<string | string[]>)
    | undefined,
  data: TData,
) {
  if (typeof value === "function") {
    return await value(data);
  }

  return value ?? null;
}

function normalizeToArray(value: string | string[] | null | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getWebhookHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (!value) {
    throw new Error(`Missing Resend webhook header: ${name}`);
  }

  return value;
}

function isResendSdk(value: unknown): value is ResendSdk {
  return !!value && typeof value === "object" && "emails" in value && "webhooks" in value;
}

function getTemplatePreviewProps<TData>(component: { PreviewProps?: TData }) {
  return component.PreviewProps ?? null;
}

export function resend<const TTemplates extends EmailTemplates>(
  input: ResendIntegrationInput<TTemplates>,
) {
  const apiKey = input.apiKey ?? process.env.RESEND_API_KEY ?? undefined;
  const basePath = normalizeBasePath(input.basePath);
  const defaults = {
    from: input.defaults?.from ?? process.env.RESEND_FROM_EMAIL ?? undefined,
    replyTo: input.defaults?.replyTo ?? process.env.RESEND_REPLY_TO_EMAIL ?? undefined,
  };
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET ?? undefined;

  if (!input.instance && !apiKey) {
    throw new Error("Resend integration requires RESEND_API_KEY or an explicit instance.");
  }

  const sendPath = `${basePath}/send` as const;
  const schedulePath = `${basePath}/schedule` as const;
  const previewPath = `${basePath}/preview` as const;
  const templatesPath = `${basePath}/templates` as const;
  const webhookDefinitions = normalizeWebhookConfig<ResendWebhookEvent>({
    webhooks: input.webhooks,
    defaultName: "default",
    defaultPath: `${basePath}/webhook`,
    defaultSecret: webhookSecret,
  });

  const sdk = input.instance ?? new ResendSdk(apiKey);

  if (!isResendSdk(sdk)) {
    throw new Error("Resend integration instance is invalid.");
  }

  const templateEntries = Object.entries(input.templates);

  async function resolveTemplate(templateId: string) {
    const match = templateEntries.find(([candidate]) => candidate === templateId);
    return match as [string, EmailTemplate<any>] | undefined;
  }

  const webhookRoutes = webhookDefinitions.map((definition) =>
    integrationRoute.post<typeof definition.path, never, ResendWebhookResult>(definition.path, {
      rawBody: true,
      responseFormat: "json",
      async handler(request, context) {
        const rawBody = await request.text();
        const webhookContext = {
          request,
          route: context,
          rawBody,
          headers: request.headers,
          webhook: {
            name: definition.name,
            path: definition.path,
          },
        };

        try {
          if (!definition.secret) {
            throw new Error("Resend webhook secret is required to verify webhook events.");
          }

          const payload = sdk.webhooks.verify({
            payload: rawBody,
            webhookSecret: definition.secret,
            headers: {
              id: getWebhookHeader(request.headers, "svix-id"),
              timestamp: getWebhookHeader(request.headers, "svix-timestamp"),
              signature: getWebhookHeader(request.headers, "svix-signature"),
            },
          });
          const eventId = request.headers.get("svix-id") ?? `${payload.type}:${Date.now()}`;
          const event: ResendWebhookEvent = {
            provider: "resend",
            id: eventId,
            type: payload.type,
            data: payload.data,
            raw: payload,
          };

          await definition.onEvent?.(event, webhookContext);

          return Response.json({
            received: true,
            provider: "resend",
            webhook: definition.name,
            eventId: event.id,
            type: event.type,
          } satisfies ResendWebhookResult);
        } catch (error) {
          const override = await definition.onError?.(error, webhookContext);
          if (override) {
            return override;
          }

          return Response.json(
            {
              error: error instanceof Error ? error.message : "Resend webhook verification failed.",
            },
            {
              status: 400,
            },
          );
        }
      },
    }),
  );

  return defineIntegration({
    category: "email",
    type: "resend",
    instance: {
      basePath,
      defaults: {
        from: defaults.from ?? null,
        replyTo: normalizeToArray(defaults.replyTo),
      },
      templateIds: templateEntries.map(([id]) => id),
      liveMode: !!apiKey,
    },
    config: integrationConfig<ResolvedResendConfig>({
      label: "Resend integration",
      env: {
        apiKey: "RESEND_API_KEY",
        from: "RESEND_FROM_EMAIL",
        replyTo: "RESEND_REPLY_TO_EMAIL",
        webhookSecret: "RESEND_WEBHOOK_SECRET",
      },
      input: {
        apiKey,
        from: defaults.from,
        replyTo: defaults.replyTo,
        webhookSecret,
      },
      required: input.instance ? [] : ["apiKey"],
    }),
    api: createResendApi<TTemplates>({
      sendPath,
      schedulePath,
      previewPath,
      templatesPath,
    }),
    log: input.log,
    routes: [
      integrationRoute.post<
        typeof sendPath,
        ResendEmailSendInput<TTemplates>,
        ResendEmailSendResult<TTemplates>
      >(sendPath, {
        responseFormat: "json",
        async handler(request, context) {
          const denied = await guardEmailRoute(request, "send", input);
          if (denied) return denied;

          const body = (await request.json()) as ResendEmailSendInput<TTemplates>;
          const resolved = await resolveTemplate(body.templateId);

          if (!resolved) {
            return Response.json(
              {
                error: `Unknown email template "${body.templateId}".`,
              },
              {
                status: 400,
              },
            );
          }

          const [templateId, configuredTemplate] = resolved;
          context.req.set("email.templateId", templateId);
          context.req.set("email.data", body.data);

          const subject = await resolveTemplateString(configuredTemplate.subject, body.data);
          const previewText = await resolveTemplateString(
            configuredTemplate.previewText,
            body.data,
          );
          const from =
            body.from ??
            (await resolveTemplateString(configuredTemplate.from, body.data)) ??
            defaults.from;

          if (!subject) {
            return Response.json(
              {
                error: `Email template "${templateId}" produced an empty subject.`,
              },
              {
                status: 400,
              },
            );
          }

          if (!from) {
            return Response.json(
              {
                error:
                  "Resend email sending requires a from address. Configure defaults.from, RESEND_FROM_EMAIL, or pass body.from.",
              },
              {
                status: 400,
              },
            );
          }

          const replyTo =
            body.replyTo ??
            (await resolveReplyToValue(configuredTemplate.replyTo, body.data)) ??
            defaults.replyTo;
          const reactNode = createElement(
            configuredTemplate.component,
            body.data,
          ) as unknown as NonNullable<Parameters<typeof sdk.emails.send>[0]["react"]>;
          const result = await sdk.emails.send(
            {
              from,
              to: body.to,
              cc: body.cc,
              bcc: body.bcc,
              replyTo: replyTo ?? undefined,
              subject,
              react: reactNode,
              tags: body.tags,
              attachments: body.attachments,
              topicId: body.topicId,
              scheduledAt: body.scheduledAt,
            },
            body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : undefined,
          );

          if (result.error || !result.data?.id) {
            return Response.json(
              {
                error: result.error?.message ?? "Resend email send failed.",
              },
              {
                status: result.error?.statusCode ?? 400,
              },
            );
          }

          return Response.json({
            id: result.data.id,
            provider: "resend",
            templateId,
            from,
            to: normalizeToArray(body.to),
            subject,
            previewText,
          } satisfies ResendEmailSendResult<TTemplates>);
        },
      }),
      integrationRoute.post<
        typeof schedulePath,
        ResendEmailScheduleInput<TTemplates>,
        ResendEmailScheduleResult<TTemplates>
      >(schedulePath, {
        responseFormat: "json",
        async handler(request, context) {
          const denied = await guardEmailRoute(request, "schedule", input);
          if (denied) return denied;

          const body = (await request.json()) as ResendEmailScheduleInput<TTemplates>;
          let when: string;

          try {
            when = resolveEmailScheduleWhen(body.when);
          } catch (error) {
            return Response.json(
              {
                error: error instanceof Error ? error.message : "Invalid email scheduling input.",
              },
              {
                status: 400,
              },
            );
          }

          const resolved = await resolveTemplate(body.templateId);

          if (!resolved) {
            return Response.json(
              {
                error: `Unknown email template "${body.templateId}".`,
              },
              {
                status: 400,
              },
            );
          }

          const [templateId, configuredTemplate] = resolved;
          context.req.set("email.templateId", templateId);
          context.req.set("email.data", body.data);
          context.req.set("email.when", when);

          const subject = await resolveTemplateString(configuredTemplate.subject, body.data);
          const previewText = await resolveTemplateString(
            configuredTemplate.previewText,
            body.data,
          );
          const from =
            body.from ??
            (await resolveTemplateString(configuredTemplate.from, body.data)) ??
            defaults.from;

          if (!subject) {
            return Response.json(
              {
                error: `Email template "${templateId}" produced an empty subject.`,
              },
              {
                status: 400,
              },
            );
          }

          if (!from) {
            return Response.json(
              {
                error:
                  "Resend email scheduling requires a from address. Configure defaults.from, RESEND_FROM_EMAIL, or pass body.from.",
              },
              {
                status: 400,
              },
            );
          }

          const replyTo =
            body.replyTo ??
            (await resolveReplyToValue(configuredTemplate.replyTo, body.data)) ??
            defaults.replyTo;
          const reactNode = createElement(
            configuredTemplate.component,
            body.data,
          ) as unknown as NonNullable<Parameters<typeof sdk.emails.send>[0]["react"]>;
          const result = await sdk.emails.send(
            {
              from,
              to: body.to,
              cc: body.cc,
              bcc: body.bcc,
              replyTo: replyTo ?? undefined,
              subject,
              react: reactNode,
              tags: body.tags,
              attachments: body.attachments,
              topicId: body.topicId,
              scheduledAt: when,
            },
            body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : undefined,
          );

          if (result.error || !result.data?.id) {
            return Response.json(
              {
                error: result.error?.message ?? "Resend email scheduling failed.",
              },
              {
                status: result.error?.statusCode ?? 400,
              },
            );
          }

          return Response.json({
            id: result.data.id,
            provider: "resend",
            templateId,
            from,
            to: normalizeToArray(body.to),
            subject,
            previewText,
            when,
          } satisfies ResendEmailScheduleResult<TTemplates>);
        },
      }),
      integrationRoute.post<
        typeof previewPath,
        ResendEmailPreviewInput<TTemplates>,
        ResendEmailPreviewResult<TTemplates>
      >(previewPath, {
        responseFormat: "json",
        async handler(request, context) {
          const denied = await guardEmailRoute(request, "preview", input);
          if (denied) return denied;

          const body = (await request.json()) as ResendEmailPreviewInput<TTemplates>;
          const resolved = await resolveTemplate(body.templateId);

          if (!resolved) {
            return Response.json(
              {
                error: `Unknown email template "${body.templateId}".`,
              },
              {
                status: 400,
              },
            );
          }

          const [templateId, configuredTemplate] = resolved;
          context.req.set("email.templateId", templateId);
          context.req.set("email.data", body.data);

          const subject = await resolveTemplateString(configuredTemplate.subject, body.data);
          const previewText = await resolveTemplateString(
            configuredTemplate.previewText,
            body.data,
          );

          if (!subject) {
            return Response.json(
              {
                error: `Email template "${templateId}" produced an empty subject.`,
              },
              {
                status: 400,
              },
            );
          }

          const reactNode = createElement(configuredTemplate.component, body.data);
          const html = await render(reactNode);
          const text = toPlainText(html);

          return Response.json({
            templateId,
            subject,
            previewText,
            html,
            text,
          } satisfies ResendEmailPreviewResult<TTemplates>);
        },
      }),
      integrationRoute.get<typeof templatesPath, Array<ResendEmailTemplateInfo<TTemplates>>>(
        templatesPath,
        {
          responseFormat: "json",
          async handler() {
            return Response.json(
              templateEntries.map(([id, configuredTemplate]) => ({
                id,
                hasPreviewText: Boolean(configuredTemplate.previewText),
                hasCustomFrom: Boolean(configuredTemplate.from),
                hasCustomReplyTo: Boolean(configuredTemplate.replyTo),
                previewProps: getTemplatePreviewProps(configuredTemplate.component),
              })),
            );
          },
        },
      ),
      ...webhookRoutes,
    ],
  });
}
