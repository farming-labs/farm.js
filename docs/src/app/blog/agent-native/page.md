---
title: "Making your site agent-native"
description: "Four layers an agent meets at your origin, and the two most sites never reach."
---

# Making your site agent-native

KinfeMichael Tariku · Nov 2026

Something is reading your site that is not a person and not Googlebot. It arrives with a token budget, no patience for a hydration wait, and a user who asked it to do something rather than to browse.

Most advice about this ends at "add an `llms.txt`". That is the easy half of the easy layer. Below is the whole stack, in the order an agent meets it, with the requests and responses that prove each layer — from a stock app on Farm.js 0.1.48, pages written in React, about thirty lines of configuration.

<span id="the-four-layers" className="blog-heading-anchor" />

## The four layers

Agent-native is not one feature. It is four, and they are strictly ordered: each one is worthless without the one before it.

1. **Readable.** An agent can get your content as text, without executing your app.
2. **Discoverable.** It can find out what pages exist without crawling blindly.
3. **Governed.** You decide which agents may read, and which may train.
4. **Actionable.** It can _do_ something, under your authorization, not just read.

Layers one and two are a content problem, and the ecosystem has mostly solved them. Layers three and four are an authorization problem, which is why almost nothing has solved them — they are where "AI-ready" stops being a static file and starts touching your session, your middleware, and your database.

<BlogFigure kind="agent-authorize" caption="The same tool call from two callers: one is refused at authorization, the other runs the route's own middleware, schema, and handler" />

<span id="layer-1-readable" className="blog-heading-anchor" />

## Layer 1: readable

An agent that has to run your JavaScript to read your pricing page will often not bother, and when it does, it pays for every token of markup around the content it wanted.

In Farm, every page already has a Markdown representation. Not a second copy you maintain — the rendered page, converted. This page is `page.tsx`, plain React, no configuration:

```bash
curl http://localhost:3000/pricing.md
```

```md
Source: /pricing

Actions: /pricing.md?actions

# Pricing

Three plans. No seat minimums, and every plan includes the full API.

## Plans

- Hobby: free, 1,000 events a month
- Pro: $20 a month, 100,000 events
- Team: $50 a month, metered beyond 500,000 events
```

The same content answers `Accept: text/markdown` on the page's own URL, so an agent does not have to know about the `.md` convention to get text back. Add a `page.md` next to `page.tsx` and it replaces the generated version without touching the React page — useful when the generated text is accurate but you want it phrased for a reader who cannot see the layout.

What makes this more than a convenience is what comes with it. An agent with a budget does not want your whole page; it wants to know whether your page is worth reading:

```bash
curl "http://localhost:3000/pricing.md?outline"
```

```md
# Outline of /pricing.md

About 111 tokens in total. Request one section with `?section=<id>`, or read in parts with `?max_tokens=<n>`.

- [Pricing](/pricing.md?section=pricing) ~98 tokens
  - [Plans](/pricing.md?section=plans) ~33 tokens
  - [Limits](/pricing.md?section=limits) ~34 tokens
  - [Talk to us](/pricing.md?section=talk-to-us) ~11 tokens
```

A heading tree, with each section's cost and a link that returns exactly that section. `?max_tokens=2000` pages a long document into parts that break where a reader would pause, each ending with a cursor link to the next, also sent as a `Link: …; rel="next"` header. Every Markdown response carries an `ETag`, so an agent re-reading your docs weekly transfers nothing when nothing changed.

That is the layer most posts describe. Here is the part they skip.

<span id="layer-2-discoverable" className="blog-heading-anchor" />

## Layer 2: discoverable

A mirror nobody can find is a mirror nobody reads. `/llms.txt` is on by default and lists your static pages with their own metadata:

```md
# Acme

> Billing for small teams.

## Pages

- [Acme](http://localhost:3000/index.md): Billing for small teams.
- [Pricing — Acme](http://localhost:3000/pricing.md): Plans and limits.

## MCP

- [acme](http://localhost:3000/api/mcp): MCP server for localhost (Streamable HTTP MCP endpoint; server card at http://localhost:3000/api/mcp/server-card)
- [AI catalog](http://localhost:3000/.well-known/ai-catalog.json): MCP server cards for this site
```

Note the second section. The index does not only say what there is to read — it says what there is to _call_, and where the machine-readable description of those tools lives. That is layer two doing its job for layer four.

`/llms-full.txt` inlines every listed page into one document, `sitemap.xml` and schema.org JSON-LD are generated from the metadata you already wrote, and `/.well-known/farmjs.json` describes the app itself: its version, renderer, integrations by category, and the JSON Schema of every tool it serves. One public document, the same for everyone.

Rendering a full-text index means rendering every page, which is exactly the kind of thing that turns into an outage. The production server shares one render between concurrent requests and runs one at a time, so a burst of agents cannot multiply the work; `revalidate` lets a CDN hold both files.

<span id="layer-3-governed" className="blog-heading-anchor" />

## Layer 3: governed

Now the uncomfortable question. You have just made your content trivially machine-readable. Who gets it?

"Block the AI bots" and "let the AI bots in" are both wrong, because they are the same answer to two different questions. An agent fetching your pricing page because a user asked it to is a visitor. A crawler ingesting your docs into a training set is a different relationship. Farm splits them:

```ts title="farm.config.ts"
export default defineConfig({
  agent: {
    crawlers: { search: "allow", training: "block" },
  },
});
```

That generates a `/robots.txt` with two groups: `search` covers the agents that fetch a page to cite or link it — `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User` — and `training` covers the crawlers and tokens that decide whether your content trains a model: `GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, `Applebot-Extended`, `Meta-ExternalAgent`, `Bytespider`. Blocking the second group does not affect Googlebot, and these two lists move as vendors rename things, which is the argument for them living in the framework rather than in a text file you copied from a blog post in 2024.

This is a published preference, not a control. Some vendors state that agents acting on a user's request may not follow `robots.txt`. So governance cannot stop at a crawler file, and in Farm it does not — the guarantee is further down:

**A page's Markdown is the same response that caller would have gotten for the HTML.** Not a copy that forgot about your guard. A route with a session check:

```tsx title="src/app/account/page.tsx"
export default async function Account() {
  const session = (await cookies()).get("session");
  if (!session) redirect("/signin");
  return <main>…</main>;
}
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/account     # 307 → /signin
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/account.md  # 307 → /signin
```

The mirror redirects, because the page redirects. A signed-in caller gets their own account as Markdown; an anonymous one gets the sign-in redirect, in both representations. The generated indexes go further: they fetch each page with a fresh request carrying no cookies, no `Authorization`, no custom headers, and no client IP — so a guarded page keeps its title and URL in `llms-full.txt` but arrives with no body. It was never read as anyone. Drop it from the listing entirely when even the title is too much:

```ts title="farm.config.ts"
export default defineConfig({
  agent: { llmsTxt: { exclude: ["/account"] } },
});
```

The principle this adds up to: **discovery never grants permission.** Which brings us to the layer where that principle has to survive contact with a write.

<span id="layer-4-actionable" className="blog-heading-anchor" />

## Layer 4: actionable

Reading is the easy half. The user who asked their agent about your pricing eventually wants it to _start the trial_.

The usual way to do this is to stand up an MCP server beside your app, declare the tools it offers, write schemas for their arguments, and re-implement authentication — because the MCP server is a different entry point from your API. You now have two descriptions of the same operation, two validators, and two auth paths, and the second one is the one nobody reviews.

Farm's `@farm.js/mcp` takes the other route: a tool _is_ an API route you already have. You point at the handler.

```ts title="src/app/api/projects/route.ts"
export const GET = createEndpoint(
  "/api/projects",
  {
    method: "GET",
    query: z.object({ status: z.enum(["active", "planned"]).optional() }),
    middleware: [requireToken],
  },
  async ({ query, context }) => {
    /* … */
  },
);

export const POST = createEndpoint(
  "/api/projects",
  {
    method: "POST",
    body: z.object({
      name: z.string().trim().min(2).max(80),
      status: z.enum(["active", "planned"]).default("planned"),
    }),
    middleware: [requireToken],
  },
  async ({ body, context }) => {
    /* … */
  },
);
```

```ts title="farm.config.ts"
import { GET as listProjects, POST as createProject } from "./src/app/api/projects/route";

export default defineConfig({
  mcp: {
    name: "acme",
    tools: [
      { endpoint: listProjects, name: "list_projects", description: "List projects." },
      { endpoint: createProject, name: "create_project", description: "Create a project." },
    ],
    authorize: ({ request, tools }) => {
      const token = request.headers.get("authorization");
      const writer = token === "Bearer demo-writer";
      if (!writer && token !== "Bearer demo-reader") return false;
      return {
        subject: writer ? "demo-writer" : "demo-reader",
        tools: tools.filter((t) => writer || t.name === "list_projects").map((t) => t.name),
      };
    },
  },
});
```

Four things follow from that, and each one is a thing you did not write.

**The tool catalog is per caller.** `authorize` returns which tools this caller has, so discovery itself is scoped. A reader asking `tools/list` sees one tool; the writer sees two:

```json
{
  "name": "list_projects",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "object",
        "properties": { "status": { "type": "string", "enum": ["active", "planned"] } }
      }
    },
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true, "destructiveHint": false }
}
```

**The schema came from the route.** That `enum` is the `z.enum(["active", "planned"])` on the endpoint's query, converted to JSON Schema. `readOnlyHint` was inferred because it is a `GET`. There is no second schema to drift.

**A refusal is a refusal.** The reader calling the tool it cannot see does not get a filtered result; it gets nothing to call:

```json
{ "error": { "code": -32602, "message": "Tool create_project not found" } }
```

**The route's own pipeline runs.** A tool call is a request for the endpoint's path, carrying the agent's headers, so the middleware and integration guards protecting that path run first — exactly as they do for a direct `POST`. The writer's call reaches the handler, and the response carries the `actor` that the route's _own_ middleware resolved, plus the `status` default from its _own_ schema:

```json
{
  "project": { "id": "project-3", "name": "Invoice redesign", "status": "planned" },
  "actor": "demo-writer"
}
```

And when the model invents a bad argument, your validator catches it, with your message:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Input validation error: … #/body/name: String is too short (1 < 2)."
    }
  ],
  "isError": true
}
```

That error is the point of the whole design. The agent hit the same wall a buggy frontend would have hit, in the same place, for the same reason.

API MCP is experimental, and so is [WebMCP](/docs/plugins/webmcp), its browser-side counterpart, where a component registers tools that live only while the page is open and call your APIs with the user's own session. Without either, every app still serves a read-only MCP server at `/mcp` over its public pages — the floor is "agents can read you", not "agents can act".

<span id="when-an-action-outlives-its-request" className="blog-heading-anchor" />

## When an action outlives its request

Everything above assumes an action finishes inside one request. Plenty don't. "Issue the refund" is a database write, a payment-provider call, and a human who has to say yes, possibly tomorrow. Exposing that as a plain tool gives an agent a call that either blocks for an hour or returns before the work is real.

So the fourth layer has a second half, and it starts with an unglamorous problem: where does the agent actually run?

### The host problem

Writing an agent is the easy part now. Every framework has a good answer for the loop. What none of them answer is that your Mastra server, your LangGraph graph and your AI SDK tool loop each have to become a thing that boots on Cloudflare Workers, or Vercel, or Lambda, each of which disagrees about environment variables, background work after a response, scheduled jobs, and which Node built-ins exist.

This is the same problem Nitro solved for web frameworks, and [agent-unit](https://github.com/farming-labs/agent-unit) is the equivalent for agent ones. It's a separate open-source project, not a Farm feature. One command takes the server you already have and produces a deployable build:

```bash
agent-unit build --preset cloudflare
```

Node, Bun, Deno, Cloudflare Workers, Vercel, Netlify and AWS Lambda, from the same source. A Hono app, a bare `{ fetch }` handler, or Mastra's own server builds for every one of them unchanged — your framework keeps its routes, its memory and its storage. One `agent-unit.config.ts` carries each host's settings, so run storage is files on Node, a Durable Object per run on Workers, and Upstash on Vercel without the code knowing. Secrets are read where the server runs, never baked into the build.

The differences between hosts are the actual work, and they are handled rather than documented: `agent-unit/env` reads configuration and bindings the same way everywhere, `waitUntil` keeps work alive after the response, `tasks` run on each host's own scheduler, and Workers get the Node modules that agent SDKs import anyway.

### Durable runs, when you want them

On top of that sits an optional engine, and this is what makes the refund safe to expose. In a Farm app it arrives as `@farm.js/agent`, which serves the agents in `src/agents`:

```ts title="src/agents/refund.ts"
import { defineAgent } from "agent-unit";

export default defineAgent(async (input: { orderId: string }, run) => {
  const order = await run.step("look up order", () => findOrder(input.orderId));
  const { approved } = await run.interrupt<{ approved: boolean }>("approve-refund", order);
  return approved ? await refund(order) : "kept";
});
```

Two primitives carry the weight. `run.step` runs once and is replayed from the run's journal afterwards, so a restart does not charge the card twice. `run.interrupt` pauses the run until an answer arrives, across restarts and deploys — the human approval is part of the program, not a callback you wire around it. Runs can sleep for days.

Agents written with the AI SDK, Mastra, LangGraph or the OpenAI Agents SDK work unchanged, and their own pauses become interrupts: tool approvals, Mastra's `suspend()`, LangGraph's `interrupt()`.

### What it exposes

The surfaces are the same idea as the rest of this post, which is the point:

| Request                                  | Does                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `POST /api/agent/agents/:name/runs`      | Starts a run. `Accept: text/event-stream` streams it           |
| `GET /api/agent/runs/:id/events`         | Streams its events, resuming from `?after=` or `Last-Event-ID` |
| `POST /api/agent/runs/:id/resume`        | Answers the interrupt                                          |
| `GET /api/agent/runs?status=interrupted` | Lists runs, for an approvals inbox                             |
| `GET /api/agent/manifest.json`           | Lists the agents                                               |
| `POST /api/agent/mcp`                    | The same agents, as MCP tools                                  |

That last row is the one that matters here. A caller that speaks MCP gets the durable agents in the same vocabulary as the endpoint-backed tools from the previous section, and the same app authorizes both. Every agent also gets an A2A agent card, and the event stream follows [AG-UI](https://docs.ag-ui.com), so a client reconnecting after a dropped connection picks up from the last event it saw instead of starting over.

[`examples/agent`](https://github.com/farming-labs/farm.js/tree/main/examples/agent) runs the approval flow end to end, and the [durable agents guide](/docs/integrations/agent) covers storage drivers, the sweep that wakes sleeping runs, and per-target budgets.

The honest framing: a tool call is the right shape for "what are my active projects", and a durable run is the right shape for "refund this order". A site that is agent-native for real needs both, because the second category is where the money and the mistakes are.

<span id="your-forms-are-already-actions" className="blog-heading-anchor" />

## Your forms are already actions

There is a nice consequence of layers one and four being the same app.

A Markdown mirror flattens a form into text — "Work email · Request a quote" — which tells an agent nothing about how to submit it. So a page with forms advertises one more line, the `Actions:` line you saw at the top of `/pricing.md`:

```bash
curl "http://localhost:3000/pricing.md?actions"
```

```json
{
  "page": "/pricing",
  "markdown": "/pricing.md",
  "actions": [
    {
      "type": "form",
      "method": "POST",
      "action": "/api/contact",
      "enctype": "application/x-www-form-urlencoded",
      "fields": [{ "name": "email", "type": "email", "label": "Work email", "required": true }],
      "submit": [{ "label": "Request a quote" }]
    }
  ]
}
```

Read from the rendered page, with a browser's own rules: a missing `action` submits to the page, disabled controls are left out because a browser would not submit them, password and file inputs never carry a value. When the form's target is also exposed as an MCP tool, the entry names the tool — the agent can stop reverse-engineering your form and call the typed thing instead.

<span id="where-frameworks-stop" className="blog-heading-anchor" />

## Where frameworks stop

To be fair about the landscape: layers one and two are not exotic any more. Nuxt has a first-party module that generates `llms.txt` and `llms-full.txt`, and content-driven setups in most frameworks can serve raw Markdown. In Next.js, SvelteKit, or Astro you can build all of this — a route handler per surface, a Markdown renderer, a crawler file, and an MCP server mounted in a route.

The difference is not capability. It is what you have to keep correct by hand:

| Surface                               | Hand-built                                | Farm.js                                           |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Markdown for a React page             | Render it yourself, or author pages twice | Generated from the page                           |
| Partial reads, token estimates, ETags | Yours to build                            | `?outline`, `?section`, `?max_tokens`             |
| `llms.txt`                            | A module or a route handler               | On by default                                     |
| Guarded pages excluded                | Remember to check the guard               | The mirror _is_ the guarded response              |
| Search vs training crawlers           | Maintain the agent lists                  | `crawlers: { search, training }`                  |
| MCP tool schemas                      | Write them beside your route schemas      | Derived from the route                            |
| MCP authorization                     | A second auth path                        | The route's middleware, plus a per-caller catalog |
| Form descriptions for agents          | —                                         | `?actions`                                        |
| Actions that outlive a request        | A queue, a journal, and resume logic      | `run.step` / `run.interrupt`, served as MCP       |
| Agent server on another host          | Rewrite the entrypoint per platform       | `agent-unit build --preset <host>`                |

Every row in the first column is a place where two descriptions of one operation can disagree. The failure mode is not an error page; it is an agent confidently calling a tool whose schema is a release behind, or a Markdown mirror still serving a page you put behind a paywall last month.

<span id="what-it-costs" className="blog-heading-anchor" />

## What it costs

The app in this post is a React app with three pages and one API route. Here is all of the agent configuration it has:

```ts title="farm.config.ts"
export default defineConfig({
  agent: {
    llmsTxt: { title: "Acme", summary: "Billing for small teams.", exclude: ["/account"] },
    crawlers: { search: "allow", training: "block" },
  },
  mcp: {
    name: "acme",
    tools: [
      /* two endpoints */
    ],
    authorize,
  },
});
```

You do not have to take my word for what that produces. `farm agent check` probes a running app over HTTP the way an agent meets it, so it works the same against `farm dev`, `farm start`, or production:

```bash
farm agent check http://localhost:3000 --path /pricing
```

```
PASS  Markdown mirror
      http://localhost:3000/pricing.md answers text/markdown (about 111 tokens).
PASS  Partial reads
      The mirror serves ?outline, ?section, ?max_tokens, and ETags.
PASS  robots.txt
      14 user-agent groups.
PASS  MCP endpoint
      http://localhost:3000/api/mcp requires sign-in and says how (Bearer).
WARN  Little server text
      The server HTML carries 368 characters of text; agents rarely run
      JavaScript, and checks expect at least 500.

SUMMARY  15 passed / 1 warning / 0 failed / 4 info
```

The warning is real, and it is the kind of thing this layer should catch: my demo pricing page is genuinely thin. A surface that is switched off is reported with the config that turns it on; a surface that is _advertised but broken_ — an OpenAPI spec in your catalog that 404s — fails and exits non-zero, so you can put it in CI with `--json`.

<span id="do-this-in-your-own-app" className="blog-heading-anchor" />

## Do this in your own app

In rough order of value per minute of work:

1. **Check what you already answer.** Paste your URL into [farmjs.dev/agents/check](https://farmjs.dev/agents/check). It reads only public responses, so it scores any site on any framework with nothing installed, and names the change that closes each gap. Inside a Farm app, `farm agent check` is the same idea in your terminal, with `--json` for CI. Start from the gaps, not from a blog post's checklist.
2. **Say who may train on you.** `agent: { crawlers: { search: "allow", training: "block" } }`, or the reverse. Make it a decision rather than a default.
3. **Audit one guarded page.** Fetch its `.md` while signed out. If content comes back, that is the bug this whole layer exists to prevent — in any framework.
4. **Name your index.** `agent: { llmsTxt: { title, summary, exclude } }`. The `exclude` list is the important argument.
5. **Expose exactly one tool.** Pick the most boring read-only endpoint you have, put it behind `mcp.authorize`, and watch a client discover it. Then decide, deliberately, whether anything should be writable.

Layer four is where this gets genuinely interesting, and where the industry is still improvising. The thing I would argue for is narrow: whatever an agent can do to your app should go through the same validation, the same middleware, and the same authorization as everything else. Not because agents are dangerous, but because a second path into your data is dangerous, and "for the AI" is a bad reason to build one.

<span id="try-it-on-farm-js" className="blog-heading-anchor" />

## Try it on Farm.js

None of this is a plugin you bolt on at the end. It works because the framework already knows your routes, your schemas, and your guards, which is the argument for having it in the framework at all.

If you want to see the whole stack answering on your own machine, a new app takes about a minute. Node.js 22.13 or newer:

```bash
npx @farm.js/create-app@latest my-app
cd my-app
npm run dev
```

Then, in another terminal, meet your own app the way an agent would:

```bash
npx farm agent check
```

You will get the report from the last section against your app, including the surfaces that are off and the exact config that turns each one on. Add the `agent` and `mcp` blocks as you decide you want them.

Already have an app elsewhere? `farm migrate inspect` identifies a supported source and prints a plan before changing anything; Next.js and TanStack Start have dry-run-first migrators, and Nuxt and SvelteKit have manual guides. The [migration guides](https://farmjs.dev/docs/migrations) cover both.

And if you build something with this, or hit the place where layer four stops being enough, I would genuinely like to hear about it: [open an issue](https://github.com/farming-labs/farm.js/issues), or come argue with me about the design. The agent web is early enough that the conventions are still up for grabs, and I would rather get them right than get them first.

The [agent infrastructure page](/agents) covers what we are building above this. And if you read this far without touching a terminal, [farmjs.dev/agents/check](https://farmjs.dev/agents/check) will tell you where your own site stands right now, whatever it is built with.
