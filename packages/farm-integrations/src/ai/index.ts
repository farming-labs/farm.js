import { createEndpoint } from "@farmjs/core";
import {
  convertToModelMessages,
  streamText,
  type LanguageModel,
  type UIMessage,
  type UIMessageStreamOptions,
} from "ai";

type AIStreamTextFunction = typeof streamText;
type AIConvertToModelMessagesFunction = typeof convertToModelMessages;
type AIStreamTextInput = Parameters<AIStreamTextFunction>[0];
type AIConvertToModelMessagesOptions = NonNullable<Parameters<AIConvertToModelMessagesFunction>[1]>;

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

export interface AIChatRouteOptions<TBody extends AIChatRequestBody = AIChatRequestBody> {
  model: LanguageModel;
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
 * export const POST = aiChatRoute({ model: "openai/gpt-4o-mini" });
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
      return createAIChatResponse(input, context.request, context.body);
    },
  );
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

  const body = bodyValidation.data as TBody;
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
