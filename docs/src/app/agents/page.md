---
title: "Agent infrastructure — Farm.js"
description: "Farm.js apps are agent-native by default, plus upcoming infrastructure for agents, MCP servers, and agent-ready websites."
---

# Agent infrastructure

Your agents, MCP servers, and website—connected, managed, and observable from the same Farm.js codebase.

## Agent-native by default

Every Farm.js v0.1.0 app can run an agent, answer agents in Markdown, and expose the tools you choose. Discovery never grants permission; your app still authorizes every action.

- **Agent runtimes.** Register Eve or Cloudflare Agents in `farm.config.ts` (`integrations: { agent: eve() }`). `farm dev` starts the runtime and serves its routes on your app's origin. In production they ship together on Vercel (Eve) or in one Worker built with the `cloudflare-module` preset (Cloudflare Agents). On other targets, deploy the runtime separately and set its `origin`; Farm proxies to it. See [agent integrations](/docs/integrations/eve).
- **Readable by default.** Pages answer agents with a Markdown mirror, by `.md` suffix or `Accept: text/markdown`. Turn on OpenAPI and `llms.txt` with ordinary config. See [Markdown mirrors](/docs/markdown).
- **API routes as MCP tools (experimental).** Expose selected endpoints and standalone tools through one Streamable HTTP server. Each route keeps its validation and middleware, under one shared authorization policy. See the [MCP example](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp).
- **WebMCP (experimental).** Components register named tools while the page is open. They call your same-origin APIs with the user's own session, in browsers that support WebMCP. See the [WebMCP plugin](/docs/plugins/webmcp).

## What we're building next

From your codebase to the agent web. We're building a home for your agents, their tools, and the websites they work with. Connected through the framework you already use.

- **Deploy agents.** Manage agents alongside your app and follow their lifecycle.
- **Deploy MCP servers.** Connect compatible clients to them, and gather your servers behind a single tool that orchestrates them on each client's behalf, with access you explicitly allow.
- **Make websites agent-ready.** Publish readable content and discoverable tool descriptions so compatible agents can understand your site, call approved actions, and receive results.
- **Observe runs.** Follow tool calls, logs, and failures from request to response.

These are planned capabilities, not features available in Farm.js v0.1.0. Discovery does not guarantee indexing by every agent and does not grant authorization to act.

[Join the waitlist](/agents#waitlist) for updates and early access. This is not a deployment console.

[Read the announcement](/blog/0.1.0#agent-infrastructure).
