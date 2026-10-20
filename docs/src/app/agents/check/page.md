---
title: "Agent-ready check — Farm.js"
description: "Score any website on what AI agents can read and call: Markdown, llms.txt, robots.txt, MCP, OpenAPI and structured data, with a fix for each gap."
---

# Agent-ready check

Is your site ready for agents? Enter a URL at [farmjs.dev/agents/check](/agents/check) and get a score out of 100, with the evidence for each check and the change that closes each gap.

## What it checks

Every check looks at what an agent sees without a browser: the HTML, the Markdown, the discovery files, and the tools a site offers. The checks fall into three groups: can agents get in (Reach), can they read it (Read), and can they use it (Act).

| Group | Check                        | Looks at                                                                      | Points |
| ----- | ---------------------------- | ----------------------------------------------------------------------------- | ------ |
| Reach | Readable without JavaScript  | Content in the HTML, not behind a sign-in or a client render.                 | 20     |
| Reach | robots.txt                   | Agents acting for users and AI search aren't blocked.                         | 15     |
| Read  | Markdown version             | A `.md` URL and `Accept: text/markdown`, linked from the page.                | 20     |
| Read  | llms.txt                     | A Markdown index of the site for language models.                             | 15     |
| Read  | Title, canonical, Open Graph | How agents name and cite the page.                                            | 10     |
| Read  | JSON-LD                      | schema.org data about who runs the site.                                      | 5      |
| Act   | MCP server                   | Tools agents can call over Streamable HTTP at `/api/mcp` or `/mcp`.           | 10     |
| Act   | OpenAPI                      | A machine-readable description of the site's API at `/openapi.json`.          | 5      |
| Act   | Agent card                   | `/.well-known/agent-card.json`. Reported, not scored, while the specs settle. | 0      |
| Act   | WebMCP                       | Tools the page registers for in-browser agents. Reported, not scored.         | 0      |

A report shows how many of each group's points the site earns, lists the gaps by the points they cost with the Farm.js config that closes each one, and copies them as a prompt for a coding agent.

Farm.js apps pass the readable and Markdown checks by default, and one `agent` block in `farm.config.ts` adds `llms.txt` and JSON-LD (see [agent readiness](/docs/configuration#agent-readiness)). See [agent infrastructure](/agents) for what comes next.
