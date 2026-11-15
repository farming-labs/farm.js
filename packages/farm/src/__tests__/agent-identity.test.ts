// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import {
  classifyFarmAgent,
  classifyFarmClient,
  FARM_INTERNAL_READ_HEADER,
} from "../agent-identity";
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

  it("names coding agents, and keeps search engines and browsers out of AI traffic", () => {
    expect(
      classifyFarmAgent("Claude-User (claude-code/2.1.319; +https://support.anthropic.com/)"),
    ).toEqual({ family: "anthropic", category: "harness", identity: "self-reported" });
    expect(
      classifyFarmAgent("codex_cli_rs/0.167.0 (Mac OS 26.2.0; arm64) iTerm.app/3.5.0"),
    ).toEqual({ family: "openai", category: "harness", identity: "self-reported" });
    expect(classifyFarmAgent(GOOGLEBOT).identity).toBe("unknown");
    expect(classifyFarmAgent("curl/8.7.1").identity).toBe("unknown");
    expect(classifyFarmAgent(CHROME).identity).toBe("unknown");
  });

  it("keeps the Infra analytics classifier on the shared table", () => {
    expect(classifyFarmInfraAgent(userAgent("Perplexity-User/1.0"))).toEqual(
      classifyFarmAgent(userAgent("Perplexity-User/1.0")),
    );
  });
});

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GOOGLEBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.6778.69 Safari/537.36";
// What every browser sends from a secure context, and Node's fetch never does.
const FETCH_METADATA = {
  "sec-fetch-site": "none",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};

function client(userAgent: string | null, headers: Record<string, string> = {}, method = "GET") {
  return classifyFarmClient(
    new Request("https://acme.test/", {
      method,
      headers: { ...(userAgent === null ? {} : { "user-agent": userAgent }), ...headers },
    }),
  );
}

describe("classifyFarmClient", () => {
  it.each([
    [
      "Claude-User (claude-code/2.1.319; +https://support.anthropic.com/)",
      "anthropic",
      "harness",
      "Claude Code",
    ],
    ["codex_cli_rs/0.167.0 (Mac OS 26.2.0; arm64) iTerm.app/3.5.0", "openai", "harness", "Codex"],
    [userAgent("ChatGPT-User/1.0"), "openai", "agent", "ChatGPT-User"],
    [userAgent("ClaudeBot/1.0"), "anthropic", "crawler", "ClaudeBot"],
    [userAgent("GPTBot/1.2"), "openai", "crawler", "GPTBot"],
    [userAgent("Perplexity-User/1.0"), "perplexity", "agent", "Perplexity-User"],
    [GOOGLEBOT, "google", "search", "Googlebot"],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
      "microsoft",
      "search",
      "Bingbot",
    ],
    [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "unknown",
      "preview",
      "Slackbot",
    ],
    [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "unknown",
      "preview",
      "facebookexternalhit",
    ],
    [
      "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
      "unknown",
      "monitor",
      "UptimeRobot",
    ],
    ["vercel-cron/1.0", "unknown", "monitor", "Vercel Cron"],
    ["farmjs-clock/1", "unknown", "monitor", "Farm.js clock"],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
      "unknown",
      "bot",
      "Headless Chrome",
    ],
    // These four are exactly what each sent to a local server.
    ["curl/8.7.1", "unknown", "script", "curl"],
    ["node", "unknown", "script", "Node.js"],
    ["Bun/1.2.3", "unknown", "script", "Bun"],
    ["Python-urllib/3.9", "unknown", "script", "Python-urllib"],
  ])("names %s", (ua, family, category, name) => {
    expect(client(ua)).toEqual({ family, category, identity: "self-reported", name });
  });

  it("counts a browser only when it sends the fetch metadata every browser sends", () => {
    expect(client(CHROME, FETCH_METADATA)).toEqual({
      family: "unknown",
      category: "browser",
      identity: "self-reported",
      name: "Chrome",
    });
    expect(
      client(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
        FETCH_METADATA,
      ).name,
    ).toBe("Safari");
    expect(
      client(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
        FETCH_METADATA,
      ).name,
    ).toBe("Firefox");
    expect(client(`${CHROME} Edg/131.0.0.0`, FETCH_METADATA).name).toBe("Edge");
    // An in-app browser names no browser we list, and is still a browser.
    expect(
      client(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0",
        FETCH_METADATA,
      ),
    ).toEqual({ family: "unknown", category: "browser", identity: "self-reported" });
  });

  it("does not count a script wearing a browser user-agent as a browser", () => {
    const unknown = { family: "unknown", category: "unknown", identity: "unknown" };
    expect(client(CHROME)).toEqual(unknown);
    // What Node's fetch adds by itself: no Sec-Fetch-Site or Sec-Fetch-Dest.
    expect(client(CHROME, { "sec-fetch-mode": "cors", "accept-language": "*" })).toEqual(unknown);
    // Bots that dress as a browser give themselves away with "compatible;" or a URL.
    expect(
      client("Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", FETCH_METADATA),
    ).toEqual({ family: "unknown", category: "bot", identity: "self-reported" });
  });

  it("recognizes ChatGPT agent by its Web Bot Auth signature agent", () => {
    expect(
      client(CHROME, {
        ...FETCH_METADATA,
        "signature-agent": '"https://chatgpt.com"',
        "signature-input": 'sig1=("@authority" "signature-agent");created=1700000000;keyid="k"',
        signature: "sig1=:AAAA:",
      }),
    ).toEqual({
      family: "openai",
      category: "agent",
      identity: "self-reported",
      name: "ChatGPT agent",
    });
    expect(
      client(CHROME, { ...FETCH_METADATA, "signature-agent": '"https://chatgpt.com.evil.test"' })
        .category,
    ).toBe("browser");
  });

  it("recognizes MCP clients by the Streamable HTTP transport's headers", () => {
    const mcp = {
      family: "unknown",
      category: "harness",
      identity: "self-reported",
      name: "MCP client",
    };
    expect(client("node", { "mcp-protocol-version": "2025-06-18" })).toEqual(mcp);
    expect(client(null, { "mcp-session-id": "abc" })).toEqual(mcp);
    // initialize comes before the client knows a version or a session.
    expect(client("node", { accept: "application/json, text/event-stream" }, "POST")).toEqual(mcp);
    expect(client("node", { accept: "application/json, text/event-stream" }).category).toBe(
      "script",
    );
    // A known AI client keeps its own name.
    expect(
      client(userAgent("Claude-User/1.0"), { "mcp-protocol-version": "2025-06-18" }).name,
    ).toBe("Claude-User");
  });

  it("leaves silent, ambiguous and look-alike clients unknown", () => {
    const unknown = { family: "unknown", category: "unknown", identity: "unknown" };
    expect(client(null)).toEqual(unknown);
    expect(client("")).toEqual(unknown);
    expect(client(`${userAgent("GPTBot/1.0")} ClaudeBot/1.0`)).toEqual(unknown);
    expect(client("NotClaudeBot/1.0").category).toBe("bot");
    expect(client("nodejs-app/1.0")).toEqual(unknown);
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
