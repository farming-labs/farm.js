// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseSearchInput,
  searchDocsTool,
  startDocsSearchTool,
  toSearchResults,
} from "./webmcp-docs-search";

afterEach(() => {
  vi.unstubAllGlobals();
});

const hits = [
  {
    url: "/docs/routing#dynamic-params",
    content: "Routing — Dynamic params",
    description: "...the same value produced by request-time routing...",
  },
  { url: "/docs/getting-started/", content: "Getting started" },
];

describe("WebMCP docs search", () => {
  it("accepts a query and an optional limit, and rejects anything else", () => {
    expect(parseSearchInput({ query: "  routing " })).toEqual({
      success: true,
      data: { query: "routing", limit: undefined },
    });
    expect(parseSearchInput({ query: "mcp", limit: 3 })).toMatchObject({ success: true });
    for (const input of [
      null,
      {},
      { query: "" },
      { query: "x", limit: 0 },
      { query: "x", limit: 2.5 },
    ])
      expect(parseSearchInput(input).success).toBe(false);
  });

  it("returns absolute page and Markdown URLs", () => {
    expect(toSearchResults(hits)).toEqual([
      {
        title: "Routing — Dynamic params",
        url: "https://farmjs.dev/docs/routing#dynamic-params",
        markdown: "https://farmjs.dev/docs/routing.md",
        snippet: "...the same value produced by request-time routing...",
      },
      {
        title: "Getting started",
        url: "https://farmjs.dev/docs/getting-started/",
        markdown: "https://farmjs.dev/docs/getting-started.md",
      },
    ]);
    expect(toSearchResults(hits, 1)).toHaveLength(1);
  });

  it("queries the docs search endpoint the search box uses", async () => {
    const fetchMock = vi.fn(async () => Response.json(hits));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const result = await searchDocsTool.execute({ query: "dynamic params", limit: 1 }, { signal });
    expect(fetchMock).toHaveBeenCalledWith("/api/docs?query=dynamic%20params", { signal });
    expect(result).toEqual({ query: "dynamic params", results: toSearchResults(hits, 1) });
    expect(searchDocsTool.annotations).toEqual({ readOnlyHint: true });
  });

  it("registers with document.modelContext through Farm's adapter", async () => {
    const registerTool = vi.fn(async () => undefined);
    vi.stubGlobal("document", { modelContext: { registerTool } });
    const stop = await startDocsSearchTool();
    expect(registerTool).toHaveBeenCalledTimes(1);
    const [tool, options] = registerTool.mock.calls[0] as unknown as [
      { name: string },
      { signal: AbortSignal },
    ];
    expect(tool.name).toBe("search_docs");
    stop();
    expect(options.signal.aborted).toBe(true);
  });

  it("falls back to navigator.modelContext", async () => {
    const registerTool = vi.fn(async () => undefined);
    vi.stubGlobal("document", {});
    vi.stubGlobal("navigator", { modelContext: { registerTool } });
    const stop = await startDocsSearchTool();
    const [tool, options] = registerTool.mock.calls[0] as unknown as [
      { name: string; execute(input: unknown): Promise<unknown> },
      { signal: AbortSignal },
    ];
    expect(tool.name).toBe("search_docs");
    await expect(tool.execute({ query: "" })).rejects.toThrow("query must be a non-empty string");
    stop();
    expect(options.signal.aborted).toBe(true);
  });
});
