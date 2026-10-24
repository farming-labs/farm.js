import { afterEach, describe, expect, it } from "vitest";
import { createFarmAiCatalogResponse, listFarmMCPLlmsTxtLinks } from "../ai-catalog";
import { resolveFarmAgentConfig } from "../agent-config";
import { createFarmDefaultLlmsTxt, resolveFarmLlmsTxtConfig } from "../llms-txt";
import { _publishFarmMCPCatalog } from "../mcp-catalog";
import { onFarmEvent } from "../observability";

const unpublish: Array<() => void> = [];

function publish(
  server: Parameters<typeof _publishFarmMCPCatalog>[0],
  details?: Parameters<typeof _publishFarmMCPCatalog>[2],
) {
  unpublish.push(_publishFarmMCPCatalog(server, [], details));
}

function get(url: string, init?: RequestInit) {
  return createFarmAiCatalogResponse(new Request(url, init), { apiServerBasePath: "/api" });
}

afterEach(() => {
  while (unpublish.length) unpublish.pop()!();
});

describe("ai catalog", () => {
  it("is on by default and turns off with false", () => {
    expect(resolveFarmAgentConfig(undefined).aiCatalog).toBe(true);
    expect(resolveFarmAgentConfig({ aiCatalog: false }).aiCatalog).toBe(false);
    expect(() => resolveFarmAgentConfig({ aiCatalog: "yes" as never })).toThrow(
      "agent.aiCatalog must be a boolean.",
    );
  });

  it("serves nothing when the app mounts no MCP server", () => {
    expect(get("https://acme.test/.well-known/ai-catalog.json")).toBeNull();
    expect(get("https://acme.test/api/mcp/server-card")).toBeNull();
  });

  it("lists each MCP server's card, served below its endpoint", async () => {
    publish(
      {
        name: "projects",
        version: "2.1.0",
        path: "/api/mcp",
        title: "Projects",
        description: "Create and search projects.",
      },
      { protocolVersions: ["2025-11-25", "2025-06-18"] },
    );

    const catalog = get("https://acme.test/.well-known/ai-catalog.json")!;
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get("content-type")).toBe("application/ai-catalog+json; charset=utf-8");
    expect(catalog.headers.get("access-control-allow-origin")).toBe("*");
    expect(await catalog.json()).toEqual({
      specVersion: "1.0",
      entries: [
        {
          identifier: "urn:air:acme.test:mcp:projects",
          type: "application/mcp-server-card+json",
          url: "https://acme.test/api/mcp/server-card",
          displayName: "Projects",
          description: "Create and search projects.",
          version: "2.1.0",
        },
      ],
    });

    // ARD crawlers read the same entries at their own path.
    const ard = get("https://acme.test/.well-known/ard.json")!;
    expect(ard.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect((await ard.json()).entries).toHaveLength(1);

    const card = get("https://acme.test/api/mcp/server-card")!;
    expect(card.status).toBe(200);
    expect(card.headers.get("content-type")).toBe(
      "application/mcp-server-card+json; charset=utf-8",
    );
    expect(await card.json()).toEqual({
      $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
      name: "test.acme/projects",
      version: "2.1.0",
      description: "Create and search projects.",
      title: "Projects",
      websiteUrl: "https://acme.test/",
      remotes: [
        {
          type: "streamable-http",
          url: "https://acme.test/api/mcp",
          supportedProtocolVersions: ["2025-11-25", "2025-06-18"],
        },
      ],
    });
  });

  it("keeps a reverse-DNS name, fills a description, and fits the card's limits", async () => {
    publish({ name: "dev.farmjs/docs", version: "1.0.0", path: "/api/docs/mcp" });
    publish({ name: "notes", version: "1.0.0", path: "/api/notes", description: "x".repeat(140) });

    const docs = await get("https://farmjs.dev/api/docs/mcp/server-card")!.json();
    expect(docs.name).toBe("dev.farmjs/docs");
    expect(docs.description).toBe("MCP server for farmjs.dev");
    expect(docs).not.toHaveProperty("title");
    expect(docs.remotes[0]).not.toHaveProperty("supportedProtocolVersions");

    // An IP address is not a domain to reverse.
    const local = await get("http://127.0.0.1:3000/api/notes/server-card")!.json();
    expect(local.name).toBe("local/notes");

    const notes = await get("https://farmjs.dev/api/notes/server-card")!.json();
    expect(notes.description).toHaveLength(100);
    expect(notes.description.endsWith("…")).toBe(true);

    const { entries } = await get("https://farmjs.dev/.well-known/ai-catalog.json")!.json();
    expect(entries.map((entry: { identifier: string }) => entry.identifier)).toEqual([
      "urn:air:farmjs.dev:mcp:docs",
      "urn:air:farmjs.dev:mcp:notes",
    ]);
  });

  it("follows the basePath for the catalog and the public API path for cards", async () => {
    publish({ name: "projects", version: "1.0.0", path: "/api/mcp" });
    const input = { basePath: "/console", apiServerBasePath: "/v1" };

    expect(
      createFarmAiCatalogResponse(new Request("https://acme.test/.well-known/ai-catalog.json"), {
        ...input,
      }),
    ).toBeNull();
    const catalog = createFarmAiCatalogResponse(
      new Request("https://acme.test/console/.well-known/ai-catalog.json"),
      input,
    )!;
    const { entries } = await catalog.json();
    expect(entries[0].url).toBe("https://acme.test/v1/mcp/server-card");

    const card = createFarmAiCatalogResponse(
      new Request("https://acme.test/v1/mcp/server-card"),
      input,
    )!;
    const body = await card.json();
    expect(body.remotes[0].url).toBe("https://acme.test/v1/mcp");
    expect(body.websiteUrl).toBe("https://acme.test/console");
    expect(
      createFarmAiCatalogResponse(new Request("https://acme.test/api/mcp/server-card"), input),
    ).toBeNull();
  });

  it("answers HEAD, OPTIONS, conditional requests, and rejects writes", async () => {
    publish({ name: "projects", version: "1.0.0", path: "/api/mcp" });
    const url = "https://acme.test/api/mcp/server-card";

    const first = get(url)!;
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"[0-9a-f]{8}"$/);
    expect(first.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");

    const head = get(url, { method: "HEAD" })!;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const notModified = get(url, { headers: { "if-none-match": etag } })!;
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(etag);

    const preflight = get(url, { method: "OPTIONS" })!;
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, If-None-Match",
    );

    const post = get(url, { method: "POST" })!;
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, OPTIONS");

    // A different origin gets its own URLs and a different validator.
    expect(get("https://other.test/api/mcp/server-card")!.headers.get("etag")).not.toBe(etag);
  });

  it("reports catalog and card reads as agent reads", () => {
    publish({ name: "projects", version: "1.0.0", path: "/api/mcp" });
    const surfaces: string[] = [];
    const stop = onFarmEvent((event) => {
      if (event.type === "agent.read") surfaces.push(event.surface);
    });
    try {
      get("https://acme.test/.well-known/ai-catalog.json", {
        headers: { "user-agent": "Claude-User/1.0" },
      });
      get("https://acme.test/api/mcp/server-card");
    } finally {
      stop();
    }
    expect(surfaces).toEqual(["ai-catalog", "mcp-server-card"]);
  });

  it("names each MCP endpoint in the generated llms.txt", () => {
    expect(listFarmMCPLlmsTxtLinks("https://acme.test")).toEqual([]);
    publish({ name: "projects", version: "1.0.0", path: "/api/mcp", title: "Projects" });

    const mcp = listFarmMCPLlmsTxtLinks("https://acme.test", { apiServerBasePath: "/api" });
    expect(mcp).toEqual([
      {
        title: "Projects",
        url: "https://acme.test/api/mcp",
        description:
          "MCP server for acme.test (Streamable HTTP MCP endpoint; server card at https://acme.test/api/mcp/server-card)",
      },
      {
        title: "AI catalog",
        url: "https://acme.test/.well-known/ai-catalog.json",
        description: "MCP server cards for this site",
      },
    ]);
    const llms = createFarmDefaultLlmsTxt({
      origin: "https://acme.test",
      pages: [],
      config: resolveFarmLlmsTxtConfig({ title: "Acme" }),
      mcp,
    });
    expect(llms.sections).toEqual([{ title: "MCP", links: mcp }]);
  });
});
