import { defineWebMCPTool, registerWebMCPTool, startWebMCPRuntime } from "@farm.js/webmcp/client";
import { SITE_URL } from "./site";

/**
 * A WebMCP tool that searches the Farm.js docs from any farmjs.dev page, through the same
 * `/api/docs?query=` endpoint the docs search box uses. components/webmcp-docs-search.tsx loads
 * this module only in browsers that expose a model context, so other visitors never download it.
 */

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

interface SearchInput {
  query: string;
  limit?: number;
}

interface DocsSearchHit {
  url: string;
  content: string;
  description?: string;
}

type SafeParse = { success: true; data: SearchInput } | { success: false; error: TypeError };

export function parseSearchInput(value: unknown): SafeParse {
  const fail = (message: string): SafeParse => ({ success: false, error: new TypeError(message) });
  if (!value || typeof value !== "object") return fail("Expected an object with a query.");
  const { query, limit } = value as Record<string, unknown>;
  if (typeof query !== "string" || !query.trim()) return fail("query must be a non-empty string.");
  if (
    limit !== undefined &&
    (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
  ) {
    return fail(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  return { success: true, data: { query: query.trim(), limit } };
}

/** Search hits as the agent gets them: absolute page and Markdown URLs, no index internals. */
export function toSearchResults(hits: readonly DocsSearchHit[], limit = DEFAULT_LIMIT) {
  return hits.slice(0, limit).map((hit) => {
    const url = new URL(hit.url, SITE_URL);
    const page = url.pathname.replace(/\/$/, "") || "/index";
    return {
      title: hit.content,
      url: url.href,
      markdown: `${url.origin}${page}.md`,
      ...(hit.description ? { snippet: hit.description } : {}),
    };
  });
}

export async function searchDocs({ query, limit }: SearchInput, signal?: AbortSignal) {
  const response = await fetch(`/api/docs?query=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error(`Docs search failed with ${response.status}`);
  const hits = (await response.json()) as DocsSearchHit[];
  return { query, results: toSearchResults(hits, limit) };
}

export const searchDocsTool = defineWebMCPTool({
  name: "search_docs",
  title: "Search the Farm.js docs",
  description:
    "Search the Farm.js documentation on farmjs.dev. Returns matching pages and sections with their URL, a Markdown URL for the full page, and a short snippet.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        description: "What to look for, such as a feature, an API, or an error message.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_LIMIT,
        description: `How many results to return. Defaults to ${DEFAULT_LIMIT}.`,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  validate: { safeParse: parseSearchInput },
  execute: (input, { signal }) => searchDocs(input, signal),
});

interface ModelContextLike {
  registerTool(tool: object, options?: { signal?: AbortSignal }): unknown;
}

/**
 * Register the tool and return its cleanup. `document.modelContext` goes through Farm's WebMCP
 * adapter; browsers that only expose the older `navigator.modelContext` get the same tool there.
 */
export async function startDocsSearchTool(): Promise<() => void> {
  if ("modelContext" in document) {
    const runtime = await startWebMCPRuntime({ unsupported: "ignore" });
    const unregister = registerWebMCPTool(searchDocsTool);
    return () => {
      unregister();
      runtime.close();
    };
  }
  const modelContext = (navigator as Navigator & { modelContext?: ModelContextLike }).modelContext;
  const controller = new AbortController();
  await modelContext?.registerTool(
    {
      name: searchDocsTool.name,
      title: searchDocsTool.title,
      description: searchDocsTool.description,
      inputSchema: searchDocsTool.inputSchema,
      annotations: searchDocsTool.annotations,
      async execute(input: unknown, options?: { signal?: AbortSignal }) {
        const parsed = parseSearchInput(input);
        if (!parsed.success) throw parsed.error;
        return searchDocs(parsed.data, options?.signal);
      },
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}
