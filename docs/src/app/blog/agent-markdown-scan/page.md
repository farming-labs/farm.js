---
title: "I asked 105 developer sites for Markdown. A third answered with HTML."
description: "What 105 developer-tool sites send an AI agent that asks for Markdown, measured on November 16, 2026."
---

# I asked 105 developer sites for Markdown. A third answered with HTML.

KinfeMichael Tariku · Nov 2026

AI agents read the web for us now. When Claude, Cursor or ChatGPT looks up an API, it fetches a docs page and pays for every byte in tokens.

So I asked a simple question: if an agent asks for Markdown, what does it get?

I picked 105 sites developers read every day (frameworks, build tools, hosting, databases, auth, payments and AI companies) and requested one docs page from each with `Accept: text/markdown`. I also checked the homepage, a `.md` URL for the same docs page, `/llms.txt` and `/mcp`.

**A third of them answer an agent with only HTML.**

<span id="the-short-version" className="blog-heading-anchor" />

## The short version

| What I checked                                                 | Sites                            |
| -------------------------------------------------------------- | -------------------------------- |
| Docs page answers `Accept: text/markdown` with Markdown        | 56 of 105 (53%)                  |
| Docs page has Markdown at a `.md` URL                          | 61 of 105 (58%)                  |
| Either one                                                     | 70 of 105 (67%)                  |
| Neither, HTML only                                             | 35 of 105 (33%)                  |
| Homepage answers `Accept: text/markdown`                       | 38 of 105 (36%)                  |
| Serves `/llms.txt`                                             | 87 of 105 (83%)                  |
| Serves `/llms-full.txt`                                        | 56 of 105 (53%)                  |
| Has an MCP server at `/mcp`                                    | 14 of 105 (13%)                  |
| All four: Markdown homepage, Markdown docs, `llms.txt`, `/mcp` | 3 of 105 (Nuxt, Turso, Mintlify) |

`llms.txt` is nearly everywhere. A Markdown answer for the page an agent actually asked for is much rarer.

<span id="html-is-35-times-bigger" className="blog-heading-anchor" />

## HTML is 35 times bigger

Across the 70 sites that serve the docs page both ways, the median page was **211 KB of HTML and 5.9 KB of Markdown**. On the median site, the Markdown was 35 times smaller.

At a rough 4 bytes per token, that's about 53,000 tokens against 1,500 for the same page. Some agent tools convert HTML to text before the model sees it. That conversion is a guess: it has to find the content among the navigation, scripts and class names, and it still downloads the whole page first.

The largest HTML answers to a Markdown request:

| Site         | Docs page sent as HTML                     |
| ------------ | ------------------------------------------ |
| PostHog      | 1.45 MB                                    |
| Mistral      | 769 KB                                     |
| Datadog      | 583 KB                                     |
| shadcn/ui    | 574 KB (also has a `.md` URL)              |
| Kubernetes   | 509 KB                                     |
| Prisma       | 451 KB (its homepage does answer Markdown) |
| Qwik         | 331 KB                                     |
| Tailwind CSS | 330 KB                                     |
| Axiom        | 316 KB (also has a `.md` URL)              |
| Angular      | 297 KB                                     |

<span id="the-tools-we-build-with-are-furthest-behind" className="blog-heading-anchor" />

## The tools we build with are furthest behind

| Category                    | Docs answer a Markdown request | Markdown by either route |
| --------------------------- | ------------------------------ | ------------------------ |
| AI companies                | 9 of 11 (82%)                  | 82%                      |
| Hosting                     | 6 of 8 (75%)                   | 75%                      |
| Databases and backends      | 12 of 17 (71%)                 | 71%                      |
| Auth, payments, SaaS        | 14 of 20 (70%)                 | 80%                      |
| Frameworks and UI libraries | 10 of 26 (38%)                 | 65%                      |
| Build tools and runtimes    | 5 of 23 (22%)                  | 43%                      |

The companies selling to agents fixed this first. The frameworks and tools developers build with mostly haven't, at least on their own docs. Nuxt is the exception: its site does all four.

That's backwards. Serving Markdown is a framework job. The framework already knows every route and what each page renders, so each site shouldn't have to bolt it on.

<span id="what-a-framework-can-do-by-default" className="blog-heading-anchor" />

## What a framework can do by default

This is why I build [Farm.js](/docs) the way I do. I generated a new app with `pnpm create @farm.js/app` (version 0.1.74), ran `farm build`, started it, and ran the same checks without changing any config:

| Request                                        | Fresh Farm app                             |
| ---------------------------------------------- | ------------------------------------------ |
| Homepage, `Accept: text/markdown`              | 626 bytes of Markdown (the HTML is 6.8 KB) |
| Docs page, `Accept: text/markdown`             | 1.5 KB of Markdown (the HTML is 22 KB)     |
| `/index.md`, `/docs.md`                        | Markdown                                   |
| `/llms.txt`, `/llms-full.txt`                  | Yes                                        |
| `/mcp`                                         | Answers `initialize`                       |
| `/.well-known/api-catalog`, agent skills index | Yes                                        |
| Sitemap, JSON-LD                               | Yes                                        |

This site runs on Farm and passes all four checks too, which is why it isn't in the totals.

Farm is still v0.x, and a framework default won't fix the sites above that run on something else. But new sites shouldn't have to choose between being readable by people and readable by agents.

<span id="check-your-own-site" className="blog-heading-anchor" />

## Check your own site

```bash
# Does your docs page answer agents in Markdown?
curl -s -o /dev/null -w "%{content_type}\n" -H "Accept: text/markdown" https://your-site.com/docs

# Is there an index for agents?
curl -s -o /dev/null -w "%{http_code}\n" https://your-site.com/llms.txt
```

Or run the scanner on your own list of sites. It has no dependencies and takes about a minute for all 109.

<span id="how-i-measured" className="blog-heading-anchor" />

## How I measured

- 109 sites, requested on November 16, 2026, from one machine with Node's built-in `fetch`, in five full runs. Each result is the majority answer across the five. Two sites changed between runs: Deno answered in Markdown in 2 of 5 runs and Netlify in 4 of 5, and the other runs got HTML. So Deno counts as no and Netlify as yes. Every other result was the same in all five runs.
- Three sites are left out. OpenAI and Contentful refused the requests (403 and 429), and Google's Gemini homepage sent response headers too large for Node's `fetch` to read. Farm's own site is scanned as a control and left out too, so the totals are out of 105.
- One homepage and one docs page per site. Other pages on the same site may behave differently.
- Requests used a generic user agent. Some sites may answer known agents, like ClaudeBot, differently.
- "Markdown" means a 200 response with a Markdown or plain-text content type and a body over 200 bytes that isn't HTML. Docker answers with a Markdown type but a 16-byte body, so it counts as no.
- `/mcp` counts a server at that exact path that answers an MCP `initialize` request or asks for auth (Prisma and Mintlify ask for auth). Sites that host MCP on another subdomain count as no.
- Sizes are decompressed response bodies. Token counts are estimates at 4 bytes per token.

The scanner, the per-site results and the script that computes every number above are in the [Farm repo](https://github.com/farming-labs/farm.js/tree/main/benchmarks/agent-readiness). If your site is listed wrong, open an issue and I'll rerun it.
