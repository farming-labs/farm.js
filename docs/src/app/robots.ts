import type { MetadataRoute } from "@farm.js/core";
import { SITE_URL } from "../lib/site";
import { SITE_SITEMAP_PATH } from "../lib/site-sitemap";

// The same crawl policy as the docs engine's generated robots.txt: everything
// is allowed, with an explicit allow for AI crawlers and agents acting for
// people. This file adds the second sitemap, for the pages outside /docs.
const AI_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: AI_USER_AGENTS, allow: "/" },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}${SITE_SITEMAP_PATH}`],
  };
}
