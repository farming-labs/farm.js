/** A post listed on /blog. Its body lives in `src/app/blog/<slug>/page.md`. */
export interface BlogPost {
  href: string;
  title: string;
  /** Shown on the index card and in the post header, and used for Open Graph. */
  description: string;
  author: string;
  authorAvatar: string;
  authorUrl: string;
  organization: string;
  organizationUrl: string;
  date: string;
  dateTime: string;
  category: string;
}

/**
 * A post's `## headings`, as the contents list shows them: the anchor id, a short label for the
 * list, and the full heading when it differs from the label's slug (a heading can be renamed
 * without breaking links already shared against its original id).
 */
export type BlogSections = readonly (
  | readonly [string, string]
  | readonly [string, string, string]
)[];

const AUTHOR = {
  author: "KinfeMichael Tariku",
  authorAvatar: "https://avatars.githubusercontent.com/u/65047246?v=4&size=96",
  authorUrl: "https://x.com/KinfishT",
  organization: "Farming Labs",
  organizationUrl: "https://github.com/farming-labs",
} as const;

export const launchPost: BlogPost = {
  href: "/blog/0.1.0",
  title: "Farm.js v0.1.0: Stable, Integrated, and Agent-Native",
  description: "Our first stable release. Built for apps and agents.",
  ...AUTHOR,
  date: "Oct 2026",
  dateTime: "2026-10-01",
  category: "Release",
};

export const launchSections = [
  ["what-stable-means", "What stable means"],
  ["the-app-foundation", "The app foundation"],
  ["five-renderers-one-framework", "Five renderers"],
  ["an-integrations-ecosystem", "Integrations"],
  ["a-plugin-ecosystem-starting-with-devtools", "Plugins & DevTools"],
  ["typed-content-collections", "Content"],
  ["local-first-data-with-sync", "Sync"],
  ["a-cli-that-explains-your-app", "The CLI"],
  ["built-for-agents-too", "Built for agents"],
  // Renamed heading; the anchor keeps its original id so shared links still work.
  ["api-routes-as-mcp-tools", "MCP composition", "API routes and standalone MCP tools"],
  ["browser-tools-with-webmcp", "Browser WebMCP"],
  ["bring-your-agent-framework", "Agent frameworks"],
  ["agent-infrastructure", "Agent infrastructure"],
  ["built-with-farm-viby", "Built with Farm: Viby"],
  ["deploy-where-you-already-are", "Deployment"],
  ["how-we-earned-stable", "Earning stable"],
  ["try-it", "Try it"],
] as const satisfies BlogSections;

export const agentNativePost: BlogPost = {
  href: "/blog/agent-native",
  title: "Making your site agent-native",
  description: "Four layers an agent meets at your origin, and the two most sites never reach.",
  ...AUTHOR,
  date: "Nov 2026",
  dateTime: "2026-11-01",
  category: "Engineering",
};

export const agentNativeSections = [
  ["the-four-layers", "The four layers"],
  ["layer-1-readable", "1 · Readable"],
  ["layer-2-discoverable", "2 · Discoverable"],
  ["layer-3-governed", "3 · Governed"],
  ["layer-4-actionable", "4 · Actionable"],
  ["when-an-action-outlives-its-request", "Durable actions"],
  ["your-forms-are-already-actions", "Forms as actions"],
  ["where-frameworks-stop", "Where frameworks stop"],
  ["what-it-costs", "What it costs"],
  ["do-this-in-your-own-app", "Do it yourself"],
  ["try-it-on-farm-js", "Try it"],
] as const satisfies BlogSections;

/** Every post, newest first. The index features the first and lists the rest. */
export const posts: readonly { post: BlogPost; sections: BlogSections }[] = [
  { post: agentNativePost, sections: agentNativeSections },
  { post: launchPost, sections: launchSections },
];

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * The section anchor a heading links to, or undefined for a heading no post lists. Markdown
 * rendering is shared by every page, so this looks across posts; a heading whose slug is already
 * its id resolves to the same anchor either way.
 */
export function getSectionId(heading: string): string | undefined {
  for (const { sections } of posts) {
    const section = sections.find((entry) =>
      entry.length > 2 ? entry[2] === heading : entry[0] === slug(heading),
    );
    if (section) return section[0];
  }
  return undefined;
}
