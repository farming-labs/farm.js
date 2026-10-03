---
title: "Agent-ready check — Farm.js"
description: "Score any website on what AI agents can read and call: Markdown, llms.txt, robots.txt, MCP, OpenAPI and structured data, with a fix for each gap."
---

# Agent-ready check

Is your site ready for agents? Enter a URL at [farmjs.dev/agents/check](/agents/check) and get a score out of 100, with the evidence for each check and the change that closes each gap.

## What it checks

Every check looks at what an agent sees without a browser: the HTML, the Markdown, the discovery files, and the tools a site offers.

| Check | Looks at | Points |
| --- | --- | --- |
| Readable without JavaScript | Content in the HTML, not behind a sign-in or a client render. | 20 |
| Markdown version | A `.md` URL and `Accept: text/markdown`, linked from the page. | 20 |
| llms.txt | A Markdown index of the site for language models. | 15 |
| robots.txt | Agents acting for users and AI search aren't blocked. | 15 |
| Title, canonical, Open Graph | How agents name and cite the page. | 10 |
| MCP server | Tools agents can call over Streamable HTTP at `/api/mcp` or `/mcp`. | 10 |
| OpenAPI | A machine-readable description of the site's API at `/openapi.json`. | 5 |
| JSON-LD | schema.org data about who runs the site. | 5 |
| Agent card | `/.well-known/agent-card.json`. Reported, not scored, while the specs settle. | 0 |
| WebMCP | Tools the page registers for in-browser agents. Reported, not scored. | 0 |

Farm.js apps answer most of these checks by default. See [agent infrastructure](/agents) for what comes next.
