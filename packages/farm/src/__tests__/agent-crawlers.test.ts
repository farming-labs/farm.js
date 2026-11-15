import { describe, expect, it } from "vitest";
import {
  FARM_AI_CRAWLERS,
  createFarmAgentRobots,
  resolveFarmAgentCrawlers,
  type FarmAgentCrawlers,
  type FarmAgentRobotsOptions,
} from "../agent-crawlers";
import { createFarmMetadataRouteResponse } from "../metadata-route";

async function renderRobots(
  crawlers: boolean | FarmAgentCrawlers,
  options: Partial<Omit<FarmAgentRobotsOptions, "crawlers">> = {},
): Promise<string> {
  const robots = createFarmAgentRobots({
    crawlers: resolveFarmAgentCrawlers(crawlers),
    ...options,
  });
  return createFarmMetadataRouteResponse("robots", robots).text();
}

const searchAgents = FARM_AI_CRAWLERS.search.map((agent) => `User-agent: ${agent}`).join("\n");
const trainingAgents = FARM_AI_CRAWLERS.training.map((agent) => `User-agent: ${agent}`).join("\n");

describe("FARM_AI_CRAWLERS", () => {
  it("lists each vendor's documented robots.txt tokens", () => {
    expect(FARM_AI_CRAWLERS).toEqual({
      search: [
        "OAI-SearchBot",
        "ChatGPT-User",
        "Claude-SearchBot",
        "Claude-User",
        "PerplexityBot",
        "Perplexity-User",
      ],
      training: [
        "GPTBot",
        "ClaudeBot",
        "Google-Extended",
        "CCBot",
        "Applebot-Extended",
        "Meta-ExternalAgent",
        "Bytespider",
      ],
    });
    const all = [...FARM_AI_CRAWLERS.search, ...FARM_AI_CRAWLERS.training];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("agent.crawlers config", () => {
  it("is off unless configured", () => {
    expect(resolveFarmAgentCrawlers(undefined)).toEqual({ enabled: false, rules: [] });
    expect(resolveFarmAgentCrawlers(false)).toEqual({ enabled: false, rules: [] });
    expect(resolveFarmAgentCrawlers({ enabled: false, training: "block" })).toEqual({
      enabled: false,
      rules: [],
    });
    expect(resolveFarmAgentCrawlers(true)).toEqual({ enabled: true, rules: [] });
  });

  it("resolves its options and accepts its own output", () => {
    const resolved = resolveFarmAgentCrawlers({
      search: "allow",
      training: "block",
      rules: [{ userAgent: "FarmBot", disallow: ["/admin/"], crawlDelay: 2 }],
      sitemap: "https://farm.test/sitemap.xml",
    });
    expect(resolved).toEqual({
      enabled: true,
      search: "allow",
      training: "block",
      rules: [{ userAgent: ["FarmBot"], disallow: ["/admin/"], crawlDelay: 2 }],
      sitemap: ["https://farm.test/sitemap.xml"],
    });
    expect(resolveFarmAgentCrawlers(resolved)).toEqual(resolved);
  });

  it("rejects values that are not robots.txt policy", () => {
    const invalid: Array<[unknown, string]> = [
      ["yes", "agent.crawlers must be true, false, or an options object."],
      [{ search: "deny" }, 'agent.crawlers.search must be "allow" or "block".'],
      [{ training: true }, 'agent.crawlers.training must be "allow" or "block".'],
      [{ rules: { userAgent: "*" } }, "agent.crawlers.rules must be an array of robots.txt rules."],
      [{ rules: ["*"] }, "agent.crawlers.rules[0] must be an object."],
      [{ rules: [{ allow: "/" }] }, "agent.crawlers.rules[0].userAgent must name at least one"],
      [
        { rules: [{ userAgent: "*", disallow: "/\nUser-agent: GPTBot" }] },
        "agent.crawlers.rules[0].disallow must be a non-empty string",
      ],
      [
        { rules: [{ userAgent: "*", crawlDelay: -1 }] },
        "agent.crawlers.rules[0].crawlDelay must be a number of seconds.",
      ],
      [{ sitemap: "/sitemap.xml" }, "agent.crawlers.sitemap must be an absolute URL"],
    ];
    for (const [input, message] of invalid) {
      expect(() => resolveFarmAgentCrawlers(input as never)).toThrow(message);
    }
  });
});

describe("generated robots.txt", () => {
  it("allows everyone when only turned on", async () => {
    expect(await renderRobots(true)).toBe("User-agent: *\nAllow: /\n");
  });

  it("writes a group for each configured crawler category", async () => {
    const cases: Array<[FarmAgentCrawlers, string]> = [
      [
        { search: "allow", training: "block" },
        `${searchAgents}\nAllow: /\n\n${trainingAgents}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`,
      ],
      [
        { search: "block", training: "allow" },
        `${searchAgents}\nDisallow: /\n\n${trainingAgents}\nAllow: /\n\nUser-agent: *\nAllow: /\n`,
      ],
      [
        { search: "allow", training: "allow" },
        `${searchAgents}\nAllow: /\n\n${trainingAgents}\nAllow: /\n\nUser-agent: *\nAllow: /\n`,
      ],
      [
        { search: "block", training: "block" },
        `${searchAgents}\nDisallow: /\n\n${trainingAgents}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`,
      ],
      [{ training: "block" }, `${trainingAgents}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`],
      [{ search: "block" }, `${searchAgents}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`],
    ];
    for (const [crawlers, expected] of cases) {
      expect(await renderRobots(crawlers)).toBe(expected);
    }
  });

  it("appends app rules, and a rule for every agent replaces the default one", async () => {
    expect(
      await renderRobots({
        training: "block",
        rules: [{ userAgent: "GPTBot", allow: "/blog/" }],
      }),
    ).toBe(
      `${trainingAgents}\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /blog/\n\nUser-agent: *\nAllow: /\n`,
    );
    expect(
      await renderRobots({
        search: "allow",
        rules: [{ userAgent: ["*"], disallow: "/" }],
      }),
    ).toBe(`${searchAgents}\nAllow: /\n\nUser-agent: *\nDisallow: /\n`);
  });

  it("points at the app's sitemap only when metadataBase makes it absolute", async () => {
    const sitemap = { sitemapPath: "/sitemap.xml" };
    expect(await renderRobots(true, { ...sitemap, metadataBase: "https://acme.test" })).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://acme.test/sitemap.xml\n",
    );
    expect(
      await renderRobots(true, {
        ...sitemap,
        metadataBase: new URL("https://acme.test/"),
        basePath: "/shop",
      }),
    ).toBe("User-agent: *\nAllow: /\n\nSitemap: https://acme.test/shop/sitemap.xml\n");
    // No metadataBase, a relative one, or no sitemap route: no Sitemap line.
    for (const options of [
      sitemap,
      { ...sitemap, metadataBase: "/" },
      { ...sitemap, metadataBase: "javascript:alert(1)" },
      { metadataBase: "https://acme.test" },
    ]) {
      expect(await renderRobots(true, options)).toBe("User-agent: *\nAllow: /\n");
    }
    // An explicit sitemap list wins, and an empty one turns the line off.
    expect(
      await renderRobots(
        { sitemap: ["https://cdn.acme.test/a.xml", "https://cdn.acme.test/b.xml"] },
        { ...sitemap, metadataBase: "https://acme.test" },
      ),
    ).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://cdn.acme.test/a.xml\nSitemap: https://cdn.acme.test/b.xml\n",
    );
    expect(
      await renderRobots({ sitemap: [] }, { ...sitemap, metadataBase: "https://acme.test" }),
    ).toBe("User-agent: *\nAllow: /\n");
  });
});
