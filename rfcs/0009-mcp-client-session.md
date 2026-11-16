# Naming the MCP client behind each tool call

Status: Implemented.

## Problem

Farm Infra shows which client made each MCP tool call. For most MCP clients it says only
"MCP client": Cursor, Claude Desktop, VS Code and Windsurf send no User-Agent token Farm can
name, so `classifyFarmClient` falls back to the MCP transport headers.

MCP clients name themselves in `initialize` (`clientInfo.name`: `cursor-vscode`, `claude-ai`,
`Visual Studio Code`). Farm's MCP servers are stateless: the default handler, the docs
runtime's server (`@farming-labs/docs`) and `@farm.js/mcp` all answer each POST on its own.
A tool call arrives in a later request, after the server has forgotten the client's name.

Claude Code already shows by name, because its User-Agent says so on every request. Captured
from Claude Code 2.1.319 against a local server:

| Request                    | User-Agent                                         | `clientInfo.name` |
| -------------------------- | -------------------------------------------------- | ----------------- |
| `initialize`               | `claude-code/2.1.319 (t3-code, agent-sdk/0.3.284)` | `claude-code`     |
| `tools/list`, `tools/call` | the same                                           | (not sent)        |

## Decision

When Farm Infra analytics is on, Farm answers a recognized client's `initialize` with an
`Mcp-Session-Id` that carries the client's name from Farm's own list:
`farm.<client>.<32 random hex digits>`, such as `farm.cursor.9f2c…`. MCP's Streamable HTTP
transport has every client send that header with each later request, and
`classifyFarmClient` reads the name back from it, so each tool call is reported as Cursor,
Claude, VS Code or the client's other listed name.

- **One place.** The analytics runtime adds the header, so every MCP server Farm serves gets it
  without changes of its own. It reads only POSTs that look like MCP (the transport's `Accept`
  or MCP headers), only JSON bodies, at most 64 KiB, from a clone, while the server answers.
- **Off when analytics is off.** Without `FARMJS_API_KEY` nothing reads request bodies and no
  response changes.
- **Only a name Farm knows.** An unrecognized `clientInfo.name` gets no session ID and stays
  "MCP client". The name in the ID is Farm's own slug, never the client's string, as with
  User-Agent tokens: the event never carries text a client chose.
- **A server's own sessions win.** A response that already has `Mcp-Session-Id` keeps it.
- **Still a declaration.** The session ID is a header any client can send, like a User-Agent.
  The identity stays `self-reported`, and nothing grants access by it.

## Compatibility

A stateless server must accept the session ID it never issued. Checked against the real
modules:

- Farm's default handler never reads `Mcp-Session-Id`; DELETE answers 405 (`Allow: POST`).
- `@modelcontextprotocol/server` 2.3.0 `createMcpHandler`, which both `@farming-labs/docs`
  and `@farm.js/mcp` use: `tools/list` and `tools/call` with an unknown session ID answer
  200; DELETE answers 405.

MCP lets a server answer DELETE with 405, and a client that ends its session that way carries
on. A client that ignores session IDs sends none and is reported as before.

## Alternatives

- **User-Agent tokens for each client.** No protocol change, but most clients send no
  distinguishing User-Agent, and their strings are undocumented.
- **Remembering `clientInfo` server-side.** Needs shared storage on serverless and edge
  targets, for a label.
- **Naming only the `initialize` request.** Infra could count which clients connect, but tool
  calls would still say "MCP client".

## Verification

- Unit: the slug list round-trips; an unknown or forged session ID stays unrecognized; the
  plugin and the recorder add the header for a recognized `initialize`, keep a server's own
  session ID, skip non-MCP and oversized bodies, and report later tool calls by name.
- The real SDK handler answers a tool call carrying a Farm session ID.

Client names come from each client's own `initialize` and the `mcp-client-capabilities`
index (0.0.14) of `clientInfo.name` values.
