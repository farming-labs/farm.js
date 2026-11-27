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

export const nativePost: BlogPost = {
  href: "/blog/web-to-native",
  title: "Your web app, native",
  description:
    "Farm's analyzer reads each page and picks a tier: a native screen with no JavaScript, a React Native screen, or a web screen.",
  ...AUTHOR,
  date: "Nov 2026",
  dateTime: "2026-11-04",
  category: "Engineering",
};

export const nativeSections = [
  ["the-three-tiers", "The three tiers"],
  ["how-the-analyzer-decides", "How the analyzer decides"],
  ["on-the-device", "On the device"],
  ["try-it", "Try it"],
] as const satisfies BlogSections;

export const nativeInternalsPost: BlogPost = {
  href: "/blog/native-internals",
  title: "How Farm draws a page natively, and when it bails out",
  description:
    "The server reads page.tsx into a tree of native views, three layers of bailout fall back to the web page, and why it is not React Native's old bridge.",
  ...AUTHOR,
  date: "Nov 2026",
  dateTime: "2026-11-08",
  category: "Engineering",
};

export const nativeInternalsSections = [
  ["one-page-three-screens", "Three kinds of screen", "One page, three kinds of screen"],
  ["drawing-a-page-without-javascript", "Drawing without JavaScript"],
  [
    "interactivity-without-javascript",
    "Forms and server actions",
    "Interactivity without JavaScript",
  ],
  ["three-layers-of-bailout", "Three layers of bailout"],
  ["isnt-this-the-bridge", "The bridge question", "Isn't this the bridge React Native removed?"],
  ["why-this-shape", "Why this shape"],
  ["try-it", "Try it"],
] as const satisfies BlogSections;

export const agentScanPost: BlogPost = {
  href: "/blog/agent-markdown-scan",
  title: "I asked 105 developer sites for Markdown. A third answered with HTML.",
  description:
    "What 105 developer-tool sites send an AI agent that asks for Markdown, and why the frameworks they are built on are furthest behind.",
  ...AUTHOR,
  date: "Nov 2026",
  dateTime: "2026-11-16",
  category: "Research",
};

export const agentScanSections = [
  ["the-short-version", "The short version"],
  ["html-is-35-times-bigger", "HTML is 35 times bigger"],
  ["the-tools-we-build-with-are-furthest-behind", "Frameworks are behind"],
  ["what-a-framework-can-do-by-default", "Framework defaults"],
  ["check-your-own-site", "Check your own site"],
  ["how-i-measured", "How I measured"],
] as const satisfies BlogSections;

export const rendererPost: BlogPost = {
  href: "/blog/bring-your-own-renderer",
  title: "Build your own renderer, build your own full-stack framework",
  description:
    "How to plug any UI library into Farm, one piece at a time: a descriptor, three small modules, a few hooks, islands, and two ways to use a component library. The working example is farming-labs/leaf.",
  ...AUTHOR,
  date: "Nov 2026",
  dateTime: "2026-11-21",
  category: "Engineering",
};

export const rendererSections = [
  ["what-farm-does-and-what-you-do", "What Farm does"],
  ["step-1-the-descriptor", "The descriptor"],
  ["step-2-the-server-module", "The server module"],
  ["step-3-the-client-module", "The client module"],
  ["step-4-the-vite-module", "The Vite module"],
  ["step-5-hooks-over-farms-stores", "Hooks", "Step 5: hooks over Farm's stores"],
  ["step-6-server-functions", "Server functions"],
  ["step-7-optional-your-own-file-format", "Your own file format"],
  ["step-8-optional-streaming", "Streaming"],
  ["step-9-optional-islands", "Islands"],
  ["step-10-test-it", "Test it"],
  ["components-the-ui-sdk-way", "Components with ui-sdk"],
  ["what-a-custom-renderer-doesnt-get", "Limits", "What a custom renderer doesn't get"],
  ["what-building-leaf-fixed-in-farm", "What leaf fixed"],
] as const satisfies BlogSections;

export const releasePreviewPost: BlogPost = {
  href: "/blog/0.2",
  title: "Farm.js 0.2 preview. From an API route to a native screen.",
  description:
    "What changed since Farm.js 0.1, from backend-only apps and Rust endpoints to React rendering, native screens, and Farm Infra.",
  ...AUTHOR,
  date: "Nov 2026",
  dateTime: "2026-11-26",
  category: "Release preview",
};

export const releasePreviewSections = [
  ["try-the-checkout-example", "Follow one order through the code"],
  ["start-with-just-an-api", "Backend-only apps", "Start with just an API"],
  [
    "put-one-compute-heavy-endpoint-in-rust",
    "Rust routes with Polyroute",
    "Put one compute-heavy endpoint in Rust",
  ],
  ["give-one-route-a-native-screen", "Mobile and desktop", "Give one route a native screen"],
  [
    "send-the-page-as-html-hydrate-the-controls-that-need-it",
    "Islands and React Flight",
    "Send the page as HTML. Hydrate the controls that need it.",
  ],
  [
    "what-the-farm-react-compiler-does-on-a-click",
    "React compiler",
    "What the Farm React compiler does on a click",
  ],
  ["bring-your-own-renderer", "Custom renderers", "Bring your own renderer"],
  [
    "an-agent-can-read-part-of-a-page-or-wait-an-hour-for-an-event",
    "Durable agents",
    "An agent can read part of a page or wait an hour for an event",
  ],
  ["farm-infra", "Farm Infra", "Farm Infra, from a checkout preview to a production incident"],
  [
    "the-rest-of-the-release-matters-when-you-operate-the-app",
    "Operating a Farm app",
    "The rest of the release matters when you operate the app",
  ],
] as const satisfies BlogSections;

export const durableAgentsPost: BlogPost = {
  href: "/blog/durable-agents",
  title: "Build durable agents with your framework and Farm Infra",
  description:
    "Keep your agent framework, make work resumable with agent-unit, and choose Farm Infra storage, wake-ups, and approvals.",
  ...AUTHOR,
  date: "Nov 2026",
  dateTime: "2026-11-27",
  category: "Tutorial",
};

export const durableAgentsSections = [
  ["start-with-a-refund-that-waits", "Start with a refund that waits"],
  ["make-the-real-side-effect-safe-to-repeat", "Make the real side effect safe to repeat"],
  ["use-your-agent-framework", "Use your agent framework"],
  ["keep-your-existing-web-app", "Keep your existing web app"],
  ["how-farm-discovers-your-agents", "How Farm discovers your agents"],
  ["choose-what-farm-infra-handles", "Choose what Farm Infra handles"],
  [
    "add-the-other-infrastructure-when-the-app-needs-it",
    "Add the other infrastructure when the app needs it",
  ],
  [
    "check-the-pause-before-adding-a-real-payment-provider",
    "Check the pause before adding a real payment provider",
  ],
] as const satisfies BlogSections;

/** Every post. The index features the first and lists the rest. */
export const posts: readonly { post: BlogPost; sections: BlogSections }[] = [
  { post: durableAgentsPost, sections: durableAgentsSections },
  { post: rendererPost, sections: rendererSections },
  { post: agentScanPost, sections: agentScanSections },
  { post: nativeInternalsPost, sections: nativeInternalsSections },
  { post: agentNativePost, sections: agentNativeSections },
  { post: nativePost, sections: nativeSections },
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
