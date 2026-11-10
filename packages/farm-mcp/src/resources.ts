import {
  fromJsonSchema,
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
  type ReadResourceResult,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type {
  FarmMCPAuthorization,
  FarmMCPExecuteContext,
  FarmMCPPrompt,
  FarmMCPPromptMessage,
  FarmMCPResource,
  FarmMCPResourceContent,
} from "@farm.js/core";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import type { RouteSchema } from "@farm.js/core/plugin";
import { parseRouteSchema } from "@farm.js/core/api/runtime";
import { toJSONSchema } from "zod";

const PROMPT_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
// The same validator tools use: it needs no code generation, so it runs on edge runtimes.
const schemaValidator = new CfWorkerJsonSchemaValidator();

export interface BoundPrompt {
  definition: FarmMCPPrompt<any>;
  argsSchema?: StandardSchemaWithJSON;
  /** The arguments' JSON Schema, for the app manifest. */
  argsJSONSchema?: Record<string, unknown>;
}

/** Validates resource definitions once, when the plugin is created. */
export function validateResources(
  resources: readonly FarmMCPResource[] | undefined,
): readonly FarmMCPResource[] {
  if (resources === undefined) return [];
  if (!Array.isArray(resources)) {
    throw new TypeError("apiMcp resources must be an array of defineResource() resources.");
  }
  const names = new Set<string>();
  for (const resource of resources) {
    if (!resource || typeof resource.name !== "string" || resource.name.length === 0) {
      throw new TypeError("apiMcp resources need a name.");
    }
    if (names.has(resource.name)) {
      throw new TypeError(`apiMcp resource name "${resource.name}" is duplicated.`);
    }
    names.add(resource.name);
    if (typeof resource.read !== "function") {
      throw new TypeError(`apiMcp resource "${resource.name}" needs a read function.`);
    }
    if ((resource.uri === undefined) === (resource.uriTemplate === undefined)) {
      throw new TypeError(`apiMcp resource "${resource.name}" needs either uri or uriTemplate.`);
    }
    if (resource.uri !== undefined && !URL.canParse(resource.uri)) {
      throw new TypeError(`apiMcp resource "${resource.name}" uri must be an absolute URI.`);
    }
    if (resource.list !== undefined && resource.uriTemplate === undefined) {
      throw new TypeError(
        `apiMcp resource "${resource.name}" can only list URIs when it has a uriTemplate.`,
      );
    }
  }
  return resources;
}

/** Validates prompt definitions and converts their argument schemas once. */
export function bindPrompts(prompts: readonly FarmMCPPrompt<any>[] | undefined): BoundPrompt[] {
  if (prompts === undefined) return [];
  if (!Array.isArray(prompts)) {
    throw new TypeError("apiMcp prompts must be an array of definePrompt() prompts.");
  }
  const names = new Set<string>();
  return prompts.map((definition) => {
    if (!definition || typeof definition.name !== "string" || !PROMPT_NAME.test(definition.name)) {
      throw new TypeError(
        "apiMcp prompts need a valid MCP name (1-128 letters, numbers, dots, underscores, or hyphens).",
      );
    }
    if (names.has(definition.name)) {
      throw new TypeError(`apiMcp prompt name "${definition.name}" is duplicated.`);
    }
    names.add(definition.name);
    if (typeof definition.render !== "function") {
      throw new TypeError(`apiMcp prompt "${definition.name}" needs a render function.`);
    }
    if (definition.arguments === undefined) return { definition };
    const json = toPromptJSONSchema(definition.arguments, definition.name);
    return {
      definition,
      argsSchema: fromJsonSchema(json, schemaValidator) as StandardSchemaWithJSON,
      argsJSONSchema: json,
    };
  });
}

function toPromptJSONSchema(schema: RouteSchema, name: string): Record<string, unknown> {
  let json: Record<string, unknown>;
  try {
    const standard = (schema as any)["~standard"]?.jsonSchema?.input;
    json = (
      typeof standard === "function"
        ? standard({ target: "draft-2020-12" })
        : toJSONSchema(schema as never, { io: "input" })
    ) as Record<string, unknown>;
  } catch (error) {
    throw new TypeError(
      `apiMcp prompt "${name}" arguments must convert to JSON Schema: ${error instanceof Error ? error.message : error}`,
    );
  }
  const properties = json.properties as Record<string, { type?: unknown }> | undefined;
  if (json.type !== "object" || !properties) {
    throw new TypeError(`apiMcp prompt "${name}" arguments must describe an object.`);
  }
  // MCP sends prompt arguments as strings.
  for (const [key, property] of Object.entries(properties)) {
    if (property.type !== undefined && property.type !== "string") {
      throw new TypeError(
        `apiMcp prompt "${name}" argument "${key}" must be a string; MCP sends prompt arguments as strings.`,
      );
    }
  }
  return json;
}

interface RegisterContext {
  request: Request | undefined;
  authorization: FarmMCPAuthorization | undefined;
  allowedResources?: ReadonlySet<string>;
  allowedPrompts?: ReadonlySet<string>;
}

/** Registers the resources and prompts this caller may use on a per-request server. */
export function registerResourcesAndPrompts(
  server: McpServer,
  resources: readonly FarmMCPResource[],
  prompts: readonly BoundPrompt[],
  context: RegisterContext,
): void {
  const executeContext = (signal: AbortSignal): FarmMCPExecuteContext | undefined =>
    context.request && context.authorization
      ? {
          request: context.request,
          authorization: context.authorization,
          signal: AbortSignal.any([context.request.signal, signal]),
        }
      : undefined;

  for (const resource of resources) {
    if (context.allowedResources && !context.allowedResources.has(resource.name)) continue;
    const metadata = {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    };
    const read = async (
      uri: URL,
      variables: Record<string, string | string[]>,
      signal: AbortSignal,
    ): Promise<ReadResourceResult> => {
      const execute = executeContext(signal);
      if (!execute) throw new Error("Missing MCP authorization context.");
      let content: Awaited<ReturnType<FarmMCPResource["read"]>>;
      try {
        content = await resource.read({ ...execute, uri, variables });
      } catch (error) {
        // Undeclared errors can carry private data: log them, return a generic message.
        console.error(`[Farm.js] MCP resource "${resource.name}" failed:`, error);
        throw new Error("Farm MCP resource read failed.");
      }
      if (content === null || content === undefined) throw new ResourceNotFoundError(uri.href);
      const parts = (Array.isArray(content) ? content : [content]) as FarmMCPResourceContent[];
      return { contents: parts.map((part) => toResourceContents(part, uri, resource)) };
    };

    if (resource.uri !== undefined) {
      server.registerResource(resource.name, resource.uri, metadata, (uri, extra) =>
        read(uri, {}, extra.mcpReq.signal),
      );
      continue;
    }
    const list = resource.list;
    const template = new ResourceTemplate(resource.uriTemplate!, {
      list: list
        ? async (extra) => {
            const execute = executeContext(extra.mcpReq.signal);
            if (!execute) return { resources: [] };
            let listings: Awaited<ReturnType<NonNullable<FarmMCPResource["list"]>>>;
            try {
              listings = await list(execute);
            } catch (error) {
              console.error(`[Farm.js] MCP resource "${resource.name}" list failed:`, error);
              throw new Error("Farm MCP resource list failed.");
            }
            return {
              resources: listings.map((listing) => ({
                uri: listing.uri,
                name: listing.name ?? resource.name,
                title: listing.title ?? resource.title,
                description: listing.description ?? resource.description,
                mimeType: listing.mimeType ?? resource.mimeType,
              })),
            };
          }
        : undefined,
    });
    server.registerResource(resource.name, template, metadata, (uri, variables, extra) =>
      read(uri, variables as Record<string, string | string[]>, extra.mcpReq.signal),
    );
  }

  for (const { definition, argsSchema } of prompts) {
    if (context.allowedPrompts && !context.allowedPrompts.has(definition.name)) continue;
    const render = async (args: unknown, signal: AbortSignal) => {
      const execute = executeContext(signal);
      if (!execute) throw new Error("Missing MCP authorization context.");
      let parsed: unknown = {};
      if (definition.arguments !== undefined) {
        try {
          // The JSON Schema advertises the wire shape; the original schema owns
          // defaults, refinements, and transforms.
          parsed = await parseRouteSchema(definition.arguments, args ?? {});
        } catch (error) {
          if (error instanceof Error && Array.isArray((error as { issues?: unknown }).issues)) {
            throw new Error(error.message);
          }
          console.error(`[Farm.js] MCP prompt "${definition.name}" failed:`, error);
          throw new Error("Farm MCP prompt failed.");
        }
      }
      let result: string | readonly FarmMCPPromptMessage[];
      try {
        result = await definition.render(parsed as never, execute);
      } catch (error) {
        console.error(`[Farm.js] MCP prompt "${definition.name}" failed:`, error);
        throw new Error("Farm MCP prompt failed.");
      }
      const messages =
        typeof result === "string" ? [{ role: "user" as const, text: result }] : result;
      return {
        ...(definition.description ? { description: definition.description } : {}),
        messages: messages.map((message) => {
          if (
            !message ||
            (message.role !== "user" && message.role !== "assistant") ||
            typeof message.text !== "string"
          ) {
            console.error(
              `[Farm.js] MCP prompt "${definition.name}" returned a message without a user or assistant role and text.`,
            );
            throw new Error("Farm MCP prompt failed.");
          }
          return { role: message.role, content: { type: "text" as const, text: message.text } };
        }),
      };
    };
    const config = { title: definition.title, description: definition.description };
    if (argsSchema) {
      server.registerPrompt(definition.name, { ...config, argsSchema }, (args, extra) =>
        render(args, extra.mcpReq.signal),
      );
    } else {
      // Without a schema the SDK passes only the context; its overloads cannot express that.
      const callback = (extra: ServerContext) => render({}, extra.mcpReq.signal);
      server.registerPrompt(definition.name, config, callback as never);
    }
  }
}

function toResourceContents(
  part: FarmMCPResourceContent,
  uri: URL,
  resource: FarmMCPResource,
): ReadResourceResult["contents"][number] {
  if (typeof part === "string") {
    return { uri: uri.href, mimeType: resource.mimeType ?? "text/plain", text: part };
  }
  if (part && typeof part === "object") {
    if ("text" in part && typeof part.text === "string") {
      return {
        uri: uri.href,
        mimeType: part.mimeType ?? resource.mimeType ?? "text/plain",
        text: part.text,
      };
    }
    if ("json" in part) {
      return { uri: uri.href, mimeType: "application/json", text: JSON.stringify(part.json) };
    }
    if ("blob" in part && (part.blob instanceof Uint8Array || part.blob instanceof ArrayBuffer)) {
      const bytes = part.blob instanceof Uint8Array ? part.blob : new Uint8Array(part.blob);
      return {
        uri: uri.href,
        mimeType: part.mimeType ?? resource.mimeType ?? "application/octet-stream",
        blob: toBase64(bytes),
      };
    }
  }
  console.error(
    `[Farm.js] MCP resource "${resource.name}" returned content that is not a string, { text }, { json }, or { blob }.`,
  );
  throw new Error("Farm MCP resource read failed.");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
