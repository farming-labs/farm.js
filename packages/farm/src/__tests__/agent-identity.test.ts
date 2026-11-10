// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { classifyFarmAgent, FARM_INTERNAL_READ_HEADER } from "../agent-identity";
import { createFarmLlmsMarkdownReader } from "../llms-txt";
import { createFarmMarkdownViewResponse } from "../markdown-view";
import { createFarmApiCatalogResponse } from "../api-catalog";
import { createFarmMetadataRouteResponse } from "../metadata-route";
import { onFarmEvent, resetFarmObservability, type FarmEvent } from "../observability";
import { classifyFarmInfraAgent } from "../plugins/infra-analytics";

afterEach(() => resetFarmObservability());

function capture() {
  const events: FarmEvent[] = [];
  onFarmEvent((event) => {
    if (event.type === "agent.read") events.push(event);
  });
  return events;
}

const userAgent = (value: string) =>
  `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ${value}; +https://example.com/bot)`;

describe("classifyFarmAgent", () => {
  it("recognizes the tokens AI vendors document", () => {
    expect(classifyFarmAgent(userAgent("ChatGPT-User/1.0"))).toEqual({
      family: "openai",
      category: "agent",
      identity: "self-reported",
    });
    expect(classifyFarmAgent(userAgent("ClaudeBot/1.0")).category).toBe("crawler");
    expect(classifyFarmAgent(userAgent("Claude-User/1.0")).family).toBe("anthropic");
    expect(classifyFarmAgent(userAgent("PerplexityBot/1.0"))).toEqual({
      family: "perplexity",
      category: "crawler",
      identity: "self-reported",
    });
    expect(classifyFarmAgent("CCBot/2.0 (https://commoncrawl.org/faq/)").family).toBe("other");
  });

  it("does not guess from browsers, look-alikes, or conflicting tokens", () => {
    const unknown = { family: "unknown", category: "unknown", identity: "unknown" };
    expect(classifyFarmAgent("Mozilla/5.0 (Macintosh) Safari/605.1.15")).toEqual(unknown);
    expect(classifyFarmAgent("NotClaudeBot/1.0")).toEqual(unknown);
    expect(classifyFarmAgent(`${userAgent("GPTBot/1.0")} ClaudeBot/1.0`)).toEqual(unknown);
    expect(classifyFarmAgent(null)).toEqual(unknown);
  });

  it("keeps the Infra analytics classifier on the shared table", () => {
    expect(classifyFarmInfraAgent(userAgent("Perplexity-User/1.0"))).toEqual(
      classifyFarmAgent(userAgent("Perplexity-User/1.0")),
    );
  });
});

describe("agent.read events", () => {
  it("reports llms.txt and llms-full.txt reads with the declared agent and no query", () => {
    const events = capture();
    const request = new Request("https://acme.test/llms.txt?utm=secret", {
      headers: { "user-agent": userAgent("GPTBot/1.1") },
    });
    createFarmMetadataRouteResponse("llms", "# Acme\n", {}, { method: "GET", request });
    createFarmMetadataRouteResponse(
      "llms-full",
      new Response("gone", { status: 404 }),
      {},
      { method: "GET", request: new Request("https://acme.test/docs/llms-full.txt") },
    );
    // Other metadata routes are not agent surfaces.
    createFarmMetadataRouteResponse(
      "robots",
      { rules: [{ userAgent: "*", allow: "/" }] },
      {},
      { method: "GET", request },
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "agent.read",
        surface: "llms",
        route: "/llms.txt",
        status: 200,
        agent: { family: "openai", category: "crawler", identity: "self-reported" },
      }),
      expect.objectContaining({
        surface: "llms-full",
        route: "/docs/llms-full.txt",
        status: 404,
        agent: { family: "unknown", category: "unknown", identity: "unknown" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("utm");
  });

  it("reports API catalog reads, and nothing for a rejected method or without a request", () => {
    const events = capture();
    const input = { apiBaseURL: "/api", openapi: { specRoute: "/openapi.json" } };
    createFarmApiCatalogResponse(
      "GET",
      input,
      new Request("https://acme.test/.well-known/api-catalog", {
        headers: { "user-agent": userAgent("Claude-User/1.0") },
      }),
    );
    createFarmApiCatalogResponse(
      "POST",
      input,
      new Request("https://acme.test/.well-known/api-catalog"),
    );
    createFarmApiCatalogResponse("GET", input);
    expect(events).toEqual([
      expect.objectContaining({
        surface: "api-catalog",
        route: "/.well-known/api-catalog",
        status: 200,
        agent: expect.objectContaining({ family: "anthropic", category: "agent" }),
      }),
    ]);
  });

  it("reports Markdown reads with the view asked for", () => {
    const events = capture();
    const read = (query: string) =>
      createFarmMarkdownViewResponse({
        request: new Request(`https://acme.test/guide.md${query}`, {
          headers: { "user-agent": userAgent("Claude-User/1.0") },
        }),
        markdown: "# Guide\n\n## Install\n\nRun it.\n",
        status: 200,
        headers: new Headers({ "Content-Type": "text/markdown; charset=utf-8" }),
        markdownPath: "/guide.md",
      });
    for (const query of [
      "",
      "?outline",
      "?section=install",
      "?section=missing",
      "?max_tokens=100",
      "?actions",
    ]) {
      read(query);
    }
    expect(events.map((event: any) => [event.view, event.status])).toEqual([
      [undefined, 200],
      ["outline", 200],
      ["section", 200],
      ["section", 404],
      ["parts", 200],
      ["actions", 200],
    ]);
    expect(events.every((event: any) => event.route === "/guide.md")).toBe(true);
  });

  it("reports a failed Markdown precondition as 412", () => {
    const events = capture();
    const response = createFarmMarkdownViewResponse({
      request: new Request("https://acme.test/guide.md?outline", {
        headers: { "if-match": '"stale"' },
      }),
      markdown: "# Guide\n",
      status: 200,
      headers: new Headers(),
      markdownPath: "/guide.md",
    });
    expect(response.status).toBe(412);
    expect(events).toEqual([
      expect.objectContaining({ surface: "markdown", view: "outline", status: 412 }),
    ]);
  });

  it("does not count Farm's own reads, such as llms-full.txt reading each page", async () => {
    const events = capture();
    const seen: Request[] = [];
    const readMarkdown = createFarmLlmsMarkdownReader(async (request) => {
      seen.push(request);
      return createFarmMarkdownViewResponse({
        request,
        markdown: "# Page\n",
        status: 200,
        headers: new Headers({ "Content-Type": "text/markdown; charset=utf-8" }),
        markdownPath: "/page.md",
      });
    });
    expect(await readMarkdown("https://acme.test/page.md")).toBe("# Page\n");
    expect(seen[0]!.headers.get(FARM_INTERNAL_READ_HEADER)).toBe("llms-full");
    expect(events).toEqual([]);
  });
});
