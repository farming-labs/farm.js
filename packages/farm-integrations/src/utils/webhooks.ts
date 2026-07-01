import type { FarmIntegrationHandlerContext } from "@farmjs/core";

export interface FarmWebhookEvent<
  TProvider extends string = string,
  TType extends string = string,
  TData = unknown,
  TRaw = unknown,
> {
  provider: TProvider;
  id: string;
  type: TType;
  data: TData;
  raw: TRaw;
}

export interface FarmWebhookContext {
  request: Request;
  route: FarmIntegrationHandlerContext;
  rawBody: string;
  headers: Headers;
  webhook: {
    name: string;
    path: string;
  };
}

export interface FarmWebhookDefinition<TEvent extends FarmWebhookEvent = FarmWebhookEvent> {
  path?: string;
  secret?: string;
  onEvent?: (event: TEvent, context: FarmWebhookContext) => void | Promise<void>;
  onError?: (
    error: unknown,
    context: FarmWebhookContext,
  ) => Response | void | Promise<Response | void>;
}

export type FarmWebhookConfig<TEvent extends FarmWebhookEvent = FarmWebhookEvent> =
  | FarmWebhookDefinition<TEvent>
  | Record<string, FarmWebhookDefinition<TEvent>>;

export interface FarmNormalizedWebhookDefinition<
  TEvent extends FarmWebhookEvent = FarmWebhookEvent,
> extends FarmWebhookDefinition<TEvent> {
  name: string;
  path: string;
}

export interface FarmWebhookAckResult {
  received: true;
  provider: string;
  webhook: string;
  eventId: string;
  type: string;
}

function isWebhookDefinition(value: unknown): value is {
  path?: string;
  secret?: string;
  onEvent?: unknown;
  onError?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return "path" in value || "secret" in value || "onEvent" in value || "onError" in value;
}

export function normalizeWebhookConfig<TEvent extends FarmWebhookEvent = FarmWebhookEvent>(input: {
  webhooks?: FarmWebhookConfig<TEvent>;
  defaultName: string;
  defaultPath: string;
  defaultSecret?: string;
}): FarmNormalizedWebhookDefinition<TEvent>[] {
  const { webhooks, defaultName, defaultPath, defaultSecret } = input;

  if (!webhooks) {
    return [];
  }

  const normalized = isWebhookDefinition(webhooks)
    ? [
        {
          ...(webhooks as FarmWebhookDefinition<TEvent>),
          name: defaultName,
          path: webhooks.path ?? defaultPath,
          secret: webhooks.secret ?? defaultSecret,
        },
      ]
    : Object.entries(webhooks).map(([name, definition]) => {
        if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
          throw new Error(`Webhook "${name}" must be configured with an object.`);
        }

        if (!definition.path || !definition.path.trim()) {
          throw new Error(
            `Webhook "${name}" requires an explicit path when multiple webhooks are configured.`,
          );
        }

        return {
          ...definition,
          name,
          path: definition.path,
          secret: definition.secret ?? defaultSecret,
        };
      });

  const seenPaths = new Set<string>();
  for (const definition of normalized) {
    if (!definition.path.trim()) {
      throw new Error(`Webhook "${definition.name}" requires a non-empty path.`);
    }

    if (seenPaths.has(definition.path)) {
      throw new Error(`Webhook path "${definition.path}" is duplicated in the integration config.`);
    }
    seenPaths.add(definition.path);
  }

  return normalized;
}
