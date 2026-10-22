import type { OpenAPIPathItemObject } from "@farm.js/core";

/**
 * Hand-written OpenAPI path items for farmjs.dev's public API. Keys are relative to
 * the `/api` server, like the operations Farm generates from route files.
 *
 * The docs engine serves /api/docs without a route file, so Farm cannot describe it.
 * /api/agents/check is a plain handler whose route file opts out of the generated
 * document, because a plain handler carries no request or response schema.
 */

const json = (schema: Record<string, unknown>) => ({ "application/json": { schema } });
const text = { type: "string" };
const error = json({ type: "object", properties: { error: { type: "string" } } });

const docsFeedbackSchema = {
  type: "object",
  additionalProperties: false,
  required: ["payload"],
  properties: {
    context: {
      type: "object",
      additionalProperties: false,
      properties: {
        page: { type: "string" },
        url: { type: "string" },
        slug: { type: "string" },
        locale: { type: "string" },
        source: { type: "string" },
      },
    },
    payload: {
      type: "object",
      additionalProperties: false,
      required: ["task", "outcome"],
      properties: {
        task: { type: "string", description: "What the agent was trying to do." },
        understanding: { type: "string", description: 'How well the docs helped, e.g. "clear".' },
        outcome: { type: "string", description: 'What happened, e.g. "implemented" or "blocked".' },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        neededCodeReading: { type: "boolean" },
        missingContext: { type: "array", items: { type: "string" } },
        docIssues: { type: "array", items: { type: "string" } },
        suggestedImprovement: { type: "string" },
      },
    },
  },
};

export const farmjsAPIPaths: Record<`/${string}`, OpenAPIPathItemObject> = {
  "/docs": {
    get: {
      operationId: "getDocs",
      tags: ["docs"],
      summary: "Search the docs or read them in another format",
      description: [
        "With `query`, returns the matching sections as JSON.",
        "With `format`, returns the docs in that format: `markdown` (the page named by `path`),",
        "`llms` or `llms-full` (plain text), `config` (the docs configuration map as JSON),",
        "`sitemap-xml`, or `skill` and `agents` (Markdown).",
        "`feedback=agent&schema=1` returns the JSON Schema that agent feedback must match.",
      ].join(" "),
      parameters: [
        { name: "query", in: "query", description: "Search terms.", schema: text },
        {
          name: "format",
          in: "query",
          schema: {
            type: "string",
            enum: ["markdown", "llms", "llms-full", "config", "sitemap-xml", "skill", "agents"],
          },
        },
        {
          name: "path",
          in: "query",
          description: "Page slug for `format=markdown`, such as `openapi` for /docs/openapi.",
          schema: text,
        },
        { name: "feedback", in: "query", schema: { type: "string", enum: ["agent"] } },
        { name: "schema", in: "query", schema: { type: "string", enum: ["1"] } },
      ],
      responses: {
        200: {
          description: "Search results, a docs format, or the feedback schema",
          content: {
            ...json({
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  section: { type: "string" },
                  content: { type: "string" },
                  description: { type: "string" },
                  score: { type: "number" },
                },
              },
            }),
            "text/markdown": { schema: text },
            "text/plain": { schema: text },
            "application/xml": { schema: text },
            "application/schema+json": { schema: { type: "object" } },
          },
        },
      },
    },
    post: {
      operationId: "sendDocsFeedback",
      tags: ["docs"],
      summary: "Send agent feedback about the docs",
      parameters: [
        {
          name: "feedback",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["agent"] },
        },
      ],
      requestBody: { required: true, content: json(docsFeedbackSchema) },
      responses: {
        202: {
          description: "Feedback accepted",
          content: json({
            type: "object",
            properties: { ok: { type: "boolean" }, handled: { type: "boolean" } },
          }),
        },
        400: { description: "The feedback does not match the schema", content: error },
      },
    },
  },
  "/docs/agent/spec": {
    get: {
      operationId: "getDocsAgentSpec",
      tags: ["docs"],
      summary: "Read the docs agent manifest",
      description: "Every docs surface for agents: search, Markdown, llms.txt, MCP, and feedback.",
      responses: { 200: { description: "The agent manifest", content: json({ type: "object" }) } },
    },
  },
  "/docs/mcp": {
    post: {
      operationId: "docsMcp",
      tags: ["docs"],
      summary: "Docs MCP server",
      description:
        "Model Context Protocol over Streamable HTTP for reading and searching the docs. Send JSON-RPC 2.0 messages with `Accept: application/json, text/event-stream`.",
      requestBody: {
        required: true,
        content: json({ type: "object", description: "A JSON-RPC 2.0 message." }),
      },
      responses: {
        200: {
          description: "The JSON-RPC response",
          content: {
            "text/event-stream": { schema: text },
            ...json({ type: "object" }),
          },
        },
      },
    },
  },
  "/agents/check": {
    post: {
      operationId: "checkAgentReadiness",
      tags: ["agents"],
      summary: "Check whether a site is agent-ready",
      description:
        "Scans the site and returns the report, the same check as https://farmjs.dev/agents/check. A form submission gets a 303 to the report page instead.",
      requestBody: {
        required: true,
        content: {
          ...json({
            type: "object",
            required: ["url"],
            properties: { url: { type: "string", maxLength: 2048 } },
          }),
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              required: ["url"],
              properties: { url: { type: "string", maxLength: 2048 } },
            },
          },
        },
      },
      responses: {
        200: {
          description: "The report, when it could be fetched right away",
          content: json({
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string", description: "Opens at /agents/check/{id}." },
              scan: { type: "object", description: "The saved report." },
            },
          }),
        },
        303: { description: "Form submissions redirect to the report or back to the form" },
        400: { description: "The URL is missing or too long", content: error },
        413: { description: "The request body is over 8 KB", content: error },
        429: {
          description: "Too many checks; retry after the Retry-After header",
          content: error,
        },
        502: { description: "The check service sent an unexpected answer", content: error },
        503: { description: "The check service is unavailable", content: error },
      },
    },
  },
};
