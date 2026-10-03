// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { launchSections } from "./blog";

const post = readFileSync(new URL("../app/blog/0.1.0/page.md", import.meta.url), "utf8");

describe("launch post content", () => {
  it("closes with a migration guide and distinguishes automated and manual paths", () => {
    const closing = post.slice(post.indexOf("## Try it"));
    expect(closing).toContain("[Migrate to Farm.js](https://farmjs.dev/docs/migrations)");
    expect(closing).toContain("farm migrate inspect");
    expect(closing).toContain("Next.js and TanStack Start have dry-run-first CLI migrators");
    expect(closing).toContain("Nuxt and SvelteKit have step-by-step manual guides");
  });

  it("links to agent infrastructure without embedding the signup form", () => {
    expect(post).toContain("[Explore agent infrastructure](/agents)");
    expect(post).not.toContain("<AgentWaitlist");
    expect(post).not.toMatch(/<form\b|type=["']email["']/);
  });

  it("omits the removed limits section from the article and contents", () => {
    expect(post).not.toContain("## What still has limits");
    expect(launchSections.map(([id]) => id)).not.toContain("what-is-not-there-yet");
  });

  it("keeps every contents link anchored in the article", () => {
    for (const [id] of launchSections) expect(post).toContain(`id="${id}"`);
  });

  it("points every documentation link at an existing guide", () => {
    const paths = new Set(
      [...post.matchAll(/https:\/\/farmjs\.dev(\/docs\/[^)#\s]+)/g)].map((match) => match[1]),
    );
    for (const path of paths) {
      expect(readFileSync(new URL(`../app${path}/page.md`, import.meta.url), "utf8")).toMatch(
        /^# /m,
      );
    }
  });

  it("keeps only the SDK, Markdown request, and quick-start code samples", () => {
    const fences = [...post.matchAll(/^```\w+\n([\s\S]*?)^```/gm)].map((match) => match[1]);
    expect(fences).toHaveLength(3);
    expect(fences[0]).toContain("instance: stripeClient");
    expect(fences[1]).toContain("Accept: text/markdown");
    expect(fences[2]).toContain("npm run dev");
  });

  it("links detailed setup and MCP policies to maintained documentation", () => {
    for (const path of [
      "/docs/plugins/content",
      "/docs/docs-engine",
      "/docs/openapi",
      "/docs/plugins/mcp#declare-tools-in-config",
      "/docs/plugins/mcp#validate-tool-results",
      "/docs/plugins/mcp#authorize-individual-tools",
      "/docs/plugins/webmcp",
    ]) {
      expect(post).toContain(`https://farmjs.dev${path}`);
      const [route, anchor] = path.split("#");
      const guide = readFileSync(new URL(`../app${route}/page.md`, import.meta.url), "utf8");
      if (anchor) {
        const headings = [...guide.matchAll(/^#+ (.+)$/gm)].map((match) =>
          match[1].toLowerCase().replaceAll(" ", "-"),
        );
        expect(headings).toContain(anchor);
      }
    }
    expect(post).toContain("same allowlist controls discovery and execution");
    expect(post).not.toContain("authorize: async ({ request, tools })");
  });
});
