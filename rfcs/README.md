# Farm.js RFCs

RFCs document cross-cutting framework changes whose runtime semantics need agreement before the
implementation changes default behavior.

| RFC                                                                                                      | Status                                     | Tracking issue                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| [0001: Isolated client hydration inside server-rendered layouts](./0001-isolated-client-hydration.md)    | Implemented (experimental, off by default) | [#565](https://github.com/farming-labs/farm.js/issues/565) |
| [0002: Owned page responses and a Node response fast path](./0002-node-response-fast-path.md)            | Implemented in 0.1.29                      |                                                            |
| [0003: Server components in islands mode](./0003-islands-server-components.md)                           | Implemented in part (experimental)         |                                                            |
| [0004: Platforms: one Farm source for web, desktop and mobile](./0004-platforms.md)                      | Draft (target 0.2)                         |                                                            |
| [0005: Explicit cron infrastructure and deployment synchronization](./0005-cron-infrastructure.md)       | Implementation in progress                 |                                                            |
| [0006: Client components where `<f-island>` cannot go](./0006-islands-element-positions.md)              | Implemented (experimental, islands mode)   |                                                            |
| [0007: Kept layouts that cannot decide a request](./0007-kept-layout-guards.md)                          | Implemented (experimental, islands mode)   |                                                            |
| [0008: Platform screens (`page.kt`, `page.swift`)](./0008-platform-screens.md)                           | Draft, open for discussion                 |                                                            |
| [0009: Naming the MCP client behind each tool call](./0009-mcp-client-session.md)                        | Implemented                                |                                                            |
| [0010: A first navigation that does not wait for the renderer](./0010-renderer-free-first-navigation.md) | Implemented (islands mode)                 |                                                            |
| [0011: A first navigation out of a root that has not hydrated](./0011-waiting-root-navigation.md)        | Implemented (islands mode)                 |                                                            |
| [0012: An islands interface for renderers](./0012-renderer-islands-interface.md)                         | Draft, open for discussion                 |                                                            |
| [0013: A smaller islands runtime for pages that hydrate at load](./0013-smaller-islands-runtime.md)      | Implemented (islands mode)                 |                                                            |
