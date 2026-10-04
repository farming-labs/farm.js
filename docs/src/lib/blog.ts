export const launchPost = {
  href: "/blog/0.1.0",
  title: "Farm.js v0.1.0: Stable, Integrated, and Agent-Native",
  description: "Our first stable release. Built for apps and agents.",
  author: "KinfeMichael Tariku",
  authorAvatar: "https://avatars.githubusercontent.com/u/65047246?v=4&size=96",
  authorUrl: "https://x.com/KinfishT",
  organization: "Farming Labs",
  organizationUrl: "https://github.com/farming-labs",
  date: "Oct 2026",
  dateTime: "2026-10-01",
  category: "Release",
} as const;

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
] as const;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The launch post section anchor a heading links to, or undefined for other headings. */
export function getLaunchSectionId(heading: string): string | undefined {
  const section = launchSections.find((entry) =>
    entry.length > 2 ? entry[2] === heading : entry[0] === slug(heading),
  );
  return section?.[0];
}
