import {
  createEndpoint,
  describeIntegrationOriginRejection,
  validateIntegrationRequestOrigin,
} from "@farm.js/core";
import {
  convertToModelMessages,
  createDownload,
  streamText,
  type LanguageModel,
  type UIMessage,
  type UIMessageStreamOptions,
} from "ai";

type AIStreamTextFunction = typeof streamText;
type AIConvertToModelMessagesFunction = typeof convertToModelMessages;
type AIStreamTextInput = Parameters<AIStreamTextFunction>[0];
type AIConvertToModelMessagesOptions = NonNullable<Parameters<AIConvertToModelMessagesFunction>[1]>;
type AIDownloadFunction = NonNullable<AIStreamTextInput["experimental_download"]>;

export interface AIChatRequestBody<TMessage = Omit<UIMessage, "id">> {
  messages: TMessage[];
  [key: string]: unknown;
}

export interface AIChatValidationIssue {
  path: readonly (string | number)[];
  code: string;
  message: string;
}

export type AIChatStreamTextOptions = Partial<
  Omit<AIStreamTextInput, "model" | "messages" | "prompt">
>;

export type AIChatResponseOptions = ResponseInit &
  UIMessageStreamOptions<UIMessage> & {
    consumeSseStream?: (options: { stream: ReadableStream<string> }) => PromiseLike<void> | void;
  };

export interface AIChatPrepareContext<TBody extends AIChatRequestBody = AIChatRequestBody> {
  request: Request;
  body: TBody;
  messages: unknown[];
  modelMessages: Awaited<ReturnType<AIConvertToModelMessagesFunction>>;
}

export interface AIChatAuthorizeContext<TBody extends AIChatRequestBody = AIChatRequestBody> {
  request: Request;
  body: TBody;
}

/** Return `true` to run the completion, `false` to refuse it, or a `Response` to answer with. */
export type AIChatAuthorize<TBody extends AIChatRequestBody = AIChatRequestBody> = (
  context: AIChatAuthorizeContext<TBody>,
) => boolean | Response | Promise<boolean | Response>;

export interface AIChatRouteOptions<TBody extends AIChatRequestBody = AIChatRequestBody> {
  model: LanguageModel;
  /**
   * Decide who may run a completion, such as by checking the session. Every
   * call spends the model provider's credits, so the route answers 403 without
   * it unless `allowUnauthenticated` is set.
   */
  authorize?: AIChatAuthorize<TBody>;
  /**
   * Serve the route to anyone. Only for an app that already gates the route in
   * middleware or at the edge, or that means to offer a public completion.
   */
  allowUnauthenticated?: boolean;
  /** Extra trusted origins, using the `serverActions.allowedOrigins` syntax. */
  allowedOrigins?: readonly string[];
  /**
   * Keep `system` messages the client sends. Off by default: they are dropped,
   * so a caller cannot replace the app's instructions with its own.
   */
  allowSystemMessages?: boolean;
  system?: AIStreamTextInput["system"];
  instructions?: AIStreamTextInput["instructions"];
  streamText?: AIStreamTextFunction;
  convertToModelMessages?: AIConvertToModelMessagesFunction;
  convertToModelMessagesOptions?: AIConvertToModelMessagesOptions;
  options?: AIChatStreamTextOptions;
  responseOptions?:
    | AIChatResponseOptions
    | ((
        context: AIChatPrepareContext<TBody>,
      ) => AIChatResponseOptions | Promise<AIChatResponseOptions>);
  selectMessages?: (body: TBody, request: Request) => unknown[];
  /**
   * Hosted file URLs the route may fetch. By default a client's `file` and
   * `reasoning-file` parts must carry a `data:` URL, and the server downloads no file URL,
   * so a visitor cannot make it fetch an internal address. `true` restores the AI SDK's
   * download behavior; a function accepts only the URLs it returns `true` for.
   */
  allowFileUrls?: boolean | ((url: URL) => boolean);
  prepare?: (
    context: AIChatPrepareContext<TBody>,
  ) => AIChatStreamTextOptions | Promise<AIChatStreamTextOptions>;
}

type AIChatRequestBodySchema = {
  parse(value: unknown): AIChatRequestBody;
  safeParse(value: unknown):
    | {
        success: true;
        data: AIChatRequestBody;
      }
    | {
        success: false;
        error: {
          issues: AIChatValidationIssue[];
        };
      };
};

export const aiChatRequestBodySchema: AIChatRequestBodySchema = {
  parse(value) {
    const validation = validateAIChatRequestBody(value);
    if (!validation.success) {
      throw createAIChatValidationError(validation.issues);
    }

    return validation.data;
  },
  safeParse(value) {
    const validation = validateAIChatRequestBody(value);
    if (validation.success) {
      return validation;
    }

    return {
      success: false,
      error: {
        issues: validation.issues,
      },
    };
  },
};

/**
 * Create a Vercel AI SDK chat route for Farm's Next-style app/api convention.
 *
 * // src/app/api/chat/route.ts
 * export const POST = aiChatRoute({
 *   model: "openai/gpt-4o-mini",
 *   authorize: async ({ request }) => Boolean(await getSession(request)),
 * });
 */
export function aiChatRoute<TBody extends AIChatRequestBody = AIChatRequestBody>(
  input: AIChatRouteOptions<TBody>,
) {
  return createEndpoint(
    {
      method: "POST",
      body: aiChatRequestBodySchema,
    },
    async (context) => {
      const refused = await guardAIChatRoute(input, context.request, context.body as TBody);
      if (refused) return refused;
      return createAIChatResponse(input, context.request, context.body);
    },
  );
}

const MISSING_AI_CHAT_AUTHORIZE_ERROR =
  "The AI chat route is not authorized. Every request spends your model provider's credits, " +
  "so it refuses anonymous callers. Pass `authorize` to aiChatRoute, or set " +
  "`allowUnauthenticated: true` if the route is already gated by your own middleware.";

/**
 * The origin check stops a cross-site page from spending the app's credits
 * through a visitor's session; `authorize` is the real gate, and the route
 * fails closed without it. A request with no origin metadata still reaches
 * `authorize`, so a server-to-server caller can authenticate there.
 */
async function guardAIChatRoute<TBody extends AIChatRequestBody>(
  input: AIChatRouteOptions<TBody>,
  request: Request,
  body: TBody,
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
    const decision = await input.authorize({ request, body });
    if (decision instanceof Response) return decision;
    if (decision === true) return null;
    return Response.json({ error: "Unauthorized AI chat request." }, { status: 403 });
  }

  if (input.allowUnauthenticated === true) return null;

  return Response.json({ error: MISSING_AI_CHAT_AUTHORIZE_ERROR }, { status: 403 });
}

export const createAIChatRoute = aiChatRoute;
export const defineAIChatRoute = aiChatRoute;

async function createAIChatResponse<TBody extends AIChatRequestBody>(
  input: AIChatRouteOptions<TBody>,
  request: Request,
  bodyInput?: unknown,
) {
  const bodyValidation = validateAIChatRequestBody(bodyInput ?? (await readJsonBody(request)));
  if (!bodyValidation.success) {
    return createAIChatValidationResponse(bodyValidation.issues);
  }

  const parsedBody = bodyValidation.data as TBody;
  // A client system message would replace the app's instructions with the caller's.
  const body =
    input.allowSystemMessages === true
      ? parsedBody
      : ({
          ...parsedBody,
          messages: parsedBody.messages.filter(
            (message) => !isRecord(message) || message.role !== "system",
          ),
        } as TBody);
  if (body.messages.length === 0) {
    return createAIChatValidationResponse([
      {
        path: ["messages"],
        code: "too_small",
        message: "Expected at least one user or assistant message.",
      },
    ]);
  }
  const messages = input.selectMessages?.(body, request) ?? body.messages;
  if (!Array.isArray(messages)) {
    return createAIChatValidationResponse([
      {
        path: ["messages"],
        code: "invalid_type",
        message: "Expected selected messages to be an array.",
      },
    ]);
  }

  const fileUrlIssues = findDisallowedFileUrls(messages, input.allowFileUrls);
  if (fileUrlIssues.length > 0) {
    return createAIChatValidationResponse(fileUrlIssues);
  }

  const convertMessages = input.convertToModelMessages ?? convertToModelMessages;
  const modelMessages = await convertMessages(
    messages as Parameters<AIConvertToModelMessagesFunction>[0],
    {
      ...input.convertToModelMessagesOptions,
      tools: input.convertToModelMessagesOptions?.tools ?? (input.options as any)?.tools,
    },
  );
  const prepareContext: AIChatPrepareContext<TBody> = {
    request,
    body,
    messages,
    modelMessages,
  };
  const preparedOptions = await input.prepare?.(prepareContext);
  const streamInput = {
    // AI SDK 7 refuses system messages in `messages` unless told otherwise.
    ...(input.allowSystemMessages === true ? { allowSystemInMessages: true } : {}),
    ...(input.allowFileUrls === true
      ? {}
      : { experimental_download: createFileUrlDownload(input.allowFileUrls) }),
    ...input.options,
    system: input.system ?? input.options?.system,
    instructions: input.instructions ?? input.options?.instructions,
    ...preparedOptions,
    model: input.model,
    messages: modelMessages,
  } as AIStreamTextInput;
  const responseOptions =
    typeof input.responseOptions === "function"
      ? await input.responseOptions(prepareContext)
      : input.responseOptions;
  const stream = (input.streamText ?? streamText)(streamInput);

  return stream.toUIMessageStreamResponse(responseOptions);
}

async function readJsonBody(request: Request) {
  try {
    const text = await request.clone().text();
    if (text.trim().length === 0) {
      return undefined;
    }

    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function validateAIChatRequestBody(value: unknown):
  | {
      success: true;
      data: AIChatRequestBody;
    }
  | {
      success: false;
      issues: AIChatValidationIssue[];
    } {
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [
        {
          path: [],
          code: "invalid_type",
          message: "Expected AI chat request body to be an object.",
        },
      ],
    };
  }

  const messages = value.messages;
  if (!Array.isArray(messages)) {
    return {
      success: false,
      issues: [
        {
          path: ["messages"],
          code: "invalid_type",
          message: "Expected messages to be an array.",
        },
      ],
    };
  }

  const issues: AIChatValidationIssue[] = [];
  if (messages.length === 0) {
    issues.push({
      path: ["messages"],
      code: "too_small",
      message: "Expected at least one message.",
    });
  }

  for (const [messageIndex, message] of messages.entries()) {
    if (!isRecord(message)) {
      issues.push({
        path: ["messages", messageIndex],
        code: "invalid_type",
        message: "Expected message to be an object.",
      });
      continue;
    }

    if (!isAIMessageRole(message.role)) {
      issues.push({
        path: ["messages", messageIndex, "role"],
        code: "invalid_enum_value",
        message: "Expected message role to be system, user, or assistant.",
      });
    }

    if (!Array.isArray(message.parts)) {
      issues.push({
        path: ["messages", messageIndex, "parts"],
        code: "invalid_type",
        message: "Expected message parts to be an array.",
      });
      continue;
    }

    for (const [partIndex, part] of message.parts.entries()) {
      if (!isRecord(part) || typeof part.type !== "string") {
        issues.push({
          path: ["messages", messageIndex, "parts", partIndex],
          code: "invalid_type",
          message: "Expected message part to be an object with a string type.",
        });
      }
    }
  }

  if (issues.length > 0) {
    return {
      success: false,
      issues,
    };
  }

  return {
    success: true,
    data: value as AIChatRequestBody,
  };
}

function isDataUrl(url: URL) {
  return url.protocol === "data:";
}

/** Client file parts whose URL the server would fetch or hand on, unless the app allows it. */
function findDisallowedFileUrls(
  messages: unknown[],
  allowFileUrls: AIChatRouteOptions["allowFileUrls"],
): AIChatValidationIssue[] {
  if (allowFileUrls === true) return [];
  const issues: AIChatValidationIssue[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const [partIndex, part] of message.parts.entries()) {
      if (!isRecord(part) || (part.type !== "file" && part.type !== "reasoning-file")) continue;
      // The AI SDK sends a provider file reference instead of the URL.
      if (part.type === "file" && part.providerReference != null) continue;
      const path = ["messages", messageIndex, "parts", partIndex, "url"];
      let url: URL | undefined;
      try {
        url = typeof part.url === "string" ? new URL(part.url) : undefined;
      } catch {
        // Reported below: the AI SDK would throw on it.
      }
      if (!url) {
        issues.push({
          path,
          code: "invalid_string",
          message: "Expected file part url to be a URL.",
        });
      } else if (!isDataUrl(url) && !(typeof allowFileUrls === "function" && allowFileUrls(url))) {
        issues.push({
          path,
          code: "unsupported_file_url",
          message:
            "Expected file part url to be a data: URL. Set allowFileUrls on aiChatRoute to accept hosted files.",
        });
      }
    }
  }
  return issues;
}

/**
 * The server fetches only the file URLs the app allows, wherever the model messages got
 * them (a tool's toModelOutput, convertDataPart), instead of every URL the model cannot
 * read itself.
 */
function createFileUrlDownload(
  allowFileUrls: AIChatRouteOptions["allowFileUrls"],
): AIDownloadFunction {
  const download = createDownload();
  return (requests) =>
    Promise.all(
      requests.map(async ({ url, isUrlSupportedByModel }) => {
        if (typeof allowFileUrls !== "function" || !allowFileUrls(url)) {
          throw new Error(
            `Refusing to fetch file URL ${url.protocol}//${url.host}: set allowFileUrls on aiChatRoute to allow it.`,
          );
        }
        return isUrlSupportedByModel ? null : download({ url });
      }),
    );
}

function createAIChatValidationResponse(issues: AIChatValidationIssue[]) {
  return Response.json(
    {
      error: "AI chat request body validation failed",
      issues,
    },
    {
      status: 400,
    },
  );
}

function createAIChatValidationError(issues: AIChatValidationIssue[]) {
  const error = new Error("AI chat request body validation failed") as Error & {
    issues: AIChatValidationIssue[];
  };
  error.issues = issues;
  return error;
}

function isAIMessageRole(value: unknown) {
  return value === "system" || value === "user" || value === "assistant";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
