# Agent-readiness scan

**What developer-tool sites send an AI agent that asks for Markdown.** This is the data behind the post [I asked 105 developer sites for Markdown. A third answered with HTML.](https://farmjs.dev/blog/agent-markdown-scan)

It records what each site returns. It does not score sites or judge the content.

## Run it

```bash
for run in 1 2 3 4 5; do node scan.mjs scan-$run.json; done
node report.mjs scan-*.json --csv results.csv
```

Node 22 or newer, no dependencies. A full scan of the 109 sites takes about a minute. `report.mjs` takes one run or several; with several, each result is the majority answer across them, and sites that changed between runs are listed.

## What it requests

For each site in `sites.mjs` (category, name, homepage, one docs page):

- the homepage and the docs page, once with `Accept: text/html` and once with `Accept: text/markdown`
- the docs page at its `.md` URL (`/guide/` becomes `/guide.md`, the root becomes `/index.md`)
- on each origin: `/llms.txt`, `/llms-full.txt` (first 512 KB), a `POST /mcp` with an MCP `initialize` request, and `/.well-known/api-catalog`

Requests follow redirects, use a generic user agent, run four sites at a time, and retry a request up to three times when it fails to connect.

## What counts

- **Markdown answer:** status 200, a Markdown or `text/plain` content type, and a body over 200 bytes that is not HTML.
- **`.md` URL:** status 200 and a body over 200 bytes that is not HTML.
- **`llms.txt`:** status 200 and a body that is neither HTML nor JSON.
- **`/mcp`:** a JSON-RPC result to `initialize`, or a 401 that asks for a bearer token. MCP servers on another subdomain count as no.
- **Not counted:** sites that answer with 403 or 429, carry a `cf-mitigated` header, or fail to load. Farm.js is scanned as a control and is not counted either.

## Results

`results.csv` is the majority of five runs on November 16, 2026. The post quotes `report.mjs` output for those runs. Each row has the docs page's HTML size, whether and how it answered in Markdown, the homepage result, `llms.txt`, `llms-full.txt`, `/mcp`, the API catalog, and a note when a result needs one.

## Limits

- One homepage and one docs page per site. Other pages on the same site may behave differently.
- A generic user agent. Some sites answer known agents, like ClaudeBot, differently.
- One machine on one evening. The same request can get a different answer from one run to the next: Deno sent HTML in 3 of 5 runs and Netlify in 1 of 5.
- Sizes are decompressed bodies. Token counts in the post are estimates at 4 bytes per token.
