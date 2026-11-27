---
title: "Farm.js 0.2 preview. From an API route to a native screen."
description: "What changed since Farm.js 0.1, from backend-only apps and Rust endpoints to React rendering, native screens, and Farm Infra."
---

# Farm.js 0.2 preview. From an API route to a native screen.

KinfeMichael Tariku · Nov 2026

You can build a Farm.js app with just an API. When you need a screen, you can add a web page or a mobile screen that uses the same API.

**The 0.2 plan promotes the React compiler and server components out of experimental configuration.** Those are two independent choices. Server components decide what crosses from server to browser. The compiler decides how an eligible React component updates the DOM once it is running. The plan keeps both opt-in. The compiler already accepts its new spelling in the 0.1 series; the top-level server-components setting shown below is the planned 0.2 spelling.

The 0.1 announcement also sketched a hosted service for apps and agents. With 0.2 we can show what that became. Farm Infra gives a team one place to share a running app, see which tools get called, and answer an agent that is waiting for a person. [Farm Infra](https://app.farmjs.dev/)

Farm 0.1.0 already had typed routes, five renderers, server functions, MCP tools, and production deployments. Most examples here run on 0.1.87. The Rust integration described below landed afterward on main. [Original 0.1 announcement](https://farmjs.dev/blog/0.1.0)

<span id="try-the-checkout-example" className="blog-heading-anchor" />

## Follow one order through the code

I’ll use a shop that sells canvas bags for $12 each. The example follows one order through a price quote, a Rust packing calculation, a payment event, and a refund decision.

### Calculate the price in TypeScript

The file `src/app/api/examples/quote/route.ts` defines the quote endpoint. Zod validates the quantity before the handler calculates the price.

```ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const GET = createEndpoint(
  "/api/examples/quote",
  {
    method: "GET",
    query: z.object({ quantity: z.coerce.number().int().min(1).max(20) }),
  },
  async ({ query }) => {
    const unitPriceCents = 1200;
    return {
      item: "Canvas bag",
      currency: "USD",
      quantity: query.quantity,
      unitPriceCents,
      totalCents: query.quantity * unitPriceCents,
    };
  },
);
```

A request to `GET /api/examples/quote?quantity=3` returns this object. Prices use cents.

```json
{
  "item": "Canvas bag",
  "currency": "USD",
  "quantity": 3,
  "unitPriceCents": 1200,
  "totalCents": 3600
}
```

The docs site serves this same handler. You can open [the three-bag quote](/api/examples/quote?quantity=3) or [a quantity of zero](/api/examples/quote?quantity=0) to see the response and validation error. Its schema is also included in [the OpenAPI document](/openapi.json).

<span id="checkout-with-polyroute" className="blog-heading-anchor" />

### Calculate the packing plan in Rust

Each box holds four bags. The file `src/app/api/examples/packing/route.rs` accepts the quantity and calculates the number of boxes. Here is the complete handler, including its method and quantity checks.

```rust
use wstd::http::body::IncomingBody;
use wstd::http::server::{Finished, Responder};
use wstd::http::{IntoBody, Method, Request, Response, StatusCode};

const BAGS_PER_BOX: u32 = 4;

#[wstd::http_server]
async fn main(request: Request<IncomingBody>, responder: Responder) -> Finished {
    let response = Response::builder().header("content-type", "application/json");
    if request.method() != Method::GET {
        return responder
            .respond(
                response
                    .status(StatusCode::METHOD_NOT_ALLOWED)
                    .header("allow", "GET")
                    .body(r#"{"error":"Use GET to request a packing plan."}"#.into_body())
                    .unwrap(),
            )
            .await;
    }

    let mut quantities = request
        .uri()
        .query()
        .unwrap_or_default()
        .split('&')
        .map(|pair| pair.split_once('=').unwrap_or((pair, "")))
        .filter_map(|(name, value)| (name == "quantity").then_some(value));
    let quantity = quantities
        .next()
        .and_then(|value| value.parse::<u32>().ok());
    let (status, body) = match (quantity, quantities.next()) {
        (Some(quantity @ 1..=20), None) => (
            StatusCode::OK,
            format!(
                r#"{{"quantity":{quantity},"bagsPerBox":{BAGS_PER_BOX},"boxes":{}}}"#,
                quantity.div_ceil(BAGS_PER_BOX)
            ),
        ),
        _ => (
            StatusCode::BAD_REQUEST,
            r#"{"error":"Supply one quantity between 1 and 20."}"#.to_owned(),
        ),
    };
    responder
        .respond(response.status(status).body(body.into_body()).unwrap())
        .await
}
```

Polyroute compiles this file to WebAssembly and gives Farm a Fetch handler. Farm discovers its URL alongside the TypeScript route. The browser calls both endpoints with ordinary `fetch`.

```ts
const quoteResponse = await fetch("/api/examples/quote?quantity=3");
if (!quoteResponse.ok) throw new Error("Could not quote the order.");
const quote = await quoteResponse.json();

const packingResponse = await fetch(`/api/examples/packing?quantity=${quote.quantity}`);
if (!packingResponse.ok) throw new Error("Could not calculate the packing plan.");
const packing = await packingResponse.json();
```

For those three bags, `packing` is `{"quantity":3,"bagsPerBox":4,"boxes":1}`. For five bags, it contains `"boxes":2`. This small calculation makes the connection between the two routes easy to follow. The compute-heavy benchmark later in the article measures when moving work to Rust helps.

### Connect Polyroute and the agents

This is the example’s `farm.config.ts`. The `FARM_CHECKOUT_POLYROUTE` environment variable enables Rust routes when set to `1`. The `import.meta.env?.SSR` guard keeps the build plugin out of the built server, which uses the compiled Wasm. The agent integration discovers the functions in `src/agents` and serves them under `/api/agent`.

```ts
/// <reference types="vite/client" />
import { agent } from "@farm.js/agent";
import { defineConfig } from "@farm.js/core";

// The built server also loads this config for its agent integration. It only needs the compiled route.
const plugins = [];
if (!import.meta.env?.SSR && process.env.FARM_CHECKOUT_POLYROUTE === "1") {
  const { polyroute } = await import("@farming-labs/polyroute");
  plugins.push(polyroute());
}

export default defineConfig({
  vite: { plugins },
  integrations: {
    // The agents in src/agents, served under /api/agent in farm dev and built into the server.
    agent: agent({
      name: "farm-agents",
      storage: { driver: "fs-lite", base: process.env.AGENT_DATA ?? ".data/agents" },
    }),
  },
});
```

The example stores agent runs on the local filesystem. Polyroute is experimental, and this example has been verified with its Node server output. The repository README includes the toolchain and build instructions. [Complete example and setup](https://github.com/farming-labs/farm.js/tree/9aa9670ee9aa/examples/agent)

### Wait for the payment

The checkout function in `src/agents/checkout.ts` waits for a `payment.succeeded` event with the same order ID. When that event arrives, the run resumes and returns the amount paid.

```ts
import { defineAgent } from "agent-unit";

export default defineAgent(async (input: { orderId: string }, run) => {
  const payment = await run.waitFor<{ orderId: string; amount: number }>("payment.succeeded", {
    match: { orderId: input.orderId },
    timeout: "1h",
  });
  return { orderId: input.orderId, paid: payment.amount };
});
```

The example starts a run by sending this request.

```http
POST /api/agent/agents/checkout/runs
Content-Type: application/json

{"input":{"orderId":"bag-order-123"}}
```

After the run reports `waiting`, the demo supplies the payment event below. Its `amount` comes from the quote’s `totalCents`. A real shop would deliver this event after verifying its payment provider’s webhook.

```http
POST /api/agent/events
Content-Type: application/json

{
  "id": "payment-bag-order-123",
  "name": "payment.succeeded",
  "data": {"orderId":"bag-order-123","amount":3600}
}
```

The completed run returns `{"orderId":"bag-order-123","paid":3600}`. The `match` condition ensures another order’s payment cannot resume this checkout.

### Ask a person before refunding

The refund agent uses `run.interrupt` to pause for a decision. These lines from `src/agents/refund.ts` show the approval step after the order lookup.

```ts
const { approved } = await run.interrupt<{ approved: boolean }>("approve-refund", order);
return approved ? `refunded ${order.id}` : `kept ${order.id}`;
```

A request to `POST /api/agent/agents/refund/runs` with `{"input":{"orderId":"bag-order-123"}}` starts that agent. Once it reports `interrupted`, the caller supplies the decision at `POST /api/agent/runs/<run-id>/resume`.

```json
{ "answer": { "approved": true } }
```

The run resumes and returns `"refunded bag-order-123"`. This demo uses a placeholder order lookup and returns a message for the refund. A real refund handler would load the paid order and call the payment provider after approval. [Refund agent source](https://github.com/farming-labs/farm.js/blob/9aa9670ee9aa/examples/agent/src/agents/refund.ts)

The complete flow is now visible in the code. TypeScript calculates the price, Rust calculates the boxes, the checkout waits for its payment, and the refund waits for a person. The sections below show the rendering choices, native screens, compiler, integrations, and Farm Infra features around that app.

<span id="start-with-just-an-api" className="blog-heading-anchor" />

## Start with just an API

Say the first consumer of your app is a mobile client that needs a list of todos. Leave `renderer` unset and Farm selects React for pages. Set it to `false` and Farm builds an API server: no React install, page renderer, or browser bundle. This is the complete config from the todo example:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  renderer: false,
  api: { basePath: "/" },
  openapi: { enabled: true },
});
```

Each line does a different job. Only `renderer: false` is needed for a backend-only app. The route at `src/app/api/todos/route.ts` normally answers at `/api/todos`; setting the base path to `"/"` also makes it reachable at `/todos`. Enabling OpenAPI publishes the schema at `/openapi.json`. Here's the example's POST handler, with the app's existing `createTodo` function doing the write:

```ts
export const POST = createEndpoint(
  { body: z.object({ title: z.string().trim().min(1).max(200) }) },
  async ({ body }) => Response.json(createTodo(body.title), { status: 201 }),
);
```

An empty title fails validation. A valid one gets a 201. File routes feed Farm's typed client generator. Middleware, storage, cron, health probes and graceful shutdown still run. You can mount an existing Hono or Express handler to migrate a service a route at a time. A missing URL returns a JSON 404. Put a page or layout into this app and Farm names the offending files at startup or build time. Page-derived discovery such as the default page-reading MCP server is off in this mode. [Backend-only guide](https://farmjs.dev/docs/backend) · [Runnable todo API](https://github.com/farming-labs/farm.js/tree/v0.1.87/examples/api-server)

<span id="put-one-compute-heavy-endpoint-in-rust" className="blog-heading-anchor" />

## Put one compute-heavy endpoint in Rust

In the experimental Polyroute integration, the unit you move to Rust is a route. The checkout moves packing to Rust and keeps pricing in TypeScript. Its Farm config loads the Polyroute Vite plugin when you enable it for development or a build. The built server uses the compiled route. [Checkout configuration](https://github.com/farming-labs/farm.js/blob/9aa9670ee9aa/examples/agent/farm.config.ts)

Farm discovers the URL and runs its usual middleware. Polyroute compiles the handler to WebAssembly and supplies the Fetch adapter. In the separate prime-counting benchmark, `GET /api/primes?limit=10` returns `{"limit":10,"primes":4}`. The Rust handler decides which methods it accepts. Use `fetch` to call it: the TypeScript client generator cannot infer the schema from Rust. Removing the plugin turns Rust discovery off.

The initial verified combination is a Node server with Polyroute's default V8 WebAssembly runtime. The checkout pins `@farming-labs/polyroute@0.1.0-beta.0` from npm. Add the `wasm32-wasip2` target on the build machine and package the compiled assets with `farm build --preset node-server`. Deploy that complete output. The benchmark gives a reason to choose your endpoint carefully: at ten connections, warm p95 on the CPU-heavy request went from 57.92 ms in TypeScript to 35.00 ms in Rust. The light request went from 3.08 ms to 4.06 ms. Those are warm measurements of one endpoint on one Mac. The TypeScript control also varied by 17% between runs on the light case. [Pinned setup and example](https://github.com/farming-labs/farm.js/blob/db718d5f8/docs/src/app/docs/api-routes/page.md#experimental-rust-routes) · [Benchmark method and results](https://github.com/farming-labs/polyroute/blob/6ec6f02cac043b21be23f33e19bd5dd70a7212a8/docs/benchmarks/2026-11-26-farm-route-output.md)

<span id="give-one-route-a-native-screen" className="blog-heading-anchor" />

## Give one route a native screen

To open a form as a modal on a phone, add this to its page:

```ts
import type { FarmMobilePageConfig } from "@farm.js/core/mobile";

export const mobile = { presentation: "modal" } satisfies FarmMobilePageConfig;
```

The mobile app opens the form over the current screen. Dismiss it and you’re back where you started. Farm can also show web pages inside native tabs and keep your place when you switch tabs. [How the web shell handles navigation](https://farmjs.dev/docs/mobile/shell)

For a screen that uses the camera, put a `page.native.tsx` beside its web page. The phone opens the native screen at the same URL. Both screens can call the same API. You can also add a screen that only exists in the mobile app. [Native screens](https://farmjs.dev/docs/mobile/native-screens)

There’s a useful middle ground. The smaller Trail Guide example has no hand-written native screens. With `mobile.native.auto` enabled, Farm analyzes pages and can draw the ones it recognizes with native views from the server’s output. The route report shows which path a page takes. Start there before committing to a rewrite. The mobile builds need their platform toolchains, including Xcode for iOS. [Trail Guide and its config](https://github.com/farming-labs/farm.js/tree/v0.1.87/examples/mobile-minimal)

Desktop takes a different approach. The desktop notes example runs its Farm production server on an OS-assigned loopback port inside an Electrobun app. The window talks to that server, and notes can live in the app’s local data directory. After setting up the desktop package, `farm dev --desktop` opens the app with hot reload and `farm build --desktop` packages it. [Desktop example](https://github.com/farming-labs/farm.js/tree/v0.1.87/examples/desktop-electrobun)

<span id="send-the-page-as-html-hydrate-the-controls-that-need-it" className="blog-heading-anchor" />

## Send the page as HTML. Hydrate the controls that need it.

Take a page with a list of crops and a counter you can click. The server can send the whole list as HTML. The counter needs code in the browser. With islands, the page stays on the server and each independent client component hydrates in place. A control marked `client:visible` can wait until it enters the viewport. Other triggers include page load, browser idle time, and the first interaction. A component inside a hydrating client layout can share that layout's root. [Islands guide](https://farmjs.dev/docs/server-rendering/islands)

### Choose the server-components engine

| Setting               | What happens                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Omitted or `false`    | Farm uses its ordinary page rendering and hydration path. Selecting React does not turn on a server-components engine.                                           |
| `true`                | Turns on islands. This is the default engine **when you enable the feature**.                                                                                    |
| `{ mode: "islands" }` | Selects islands explicitly. React pages arrive as HTML with ISLX markers for client components. A custom renderer can implement islands through its own adapter. |
| `{ mode: "rsc" }`     | Selects React Flight. React reconstructs the tree from the Flight payload. This mode needs the React RSC packages.                                               |

For an app on **0.1.87**, the working configuration is `experimental: { serverComponents: { mode: "islands" } }`. For **0.2**, the planned config moves the same choice to the top level:

```ts
// Planned 0.2 configuration
export default defineConfig({
  serverComponents: { mode: "islands" },
});
```

Both engines let a server page load data and pass serializable props to a component marked `"use client"`. Consider the counter again. Islands sends its initial HTML and tells the browser where to attach the counter. Flight also describes the surrounding React tree so React can reconcile it during navigation.

An app using Flight should carry `{ mode: "rsc" }` across explicitly; changing that value to `true` selects a different transport. In islands mode, a navigation can send HTML for the page and only the changed layouts. In Flight mode, navigation sends a Flight payload. We build the same example with both engines so a form submission, click during hydration, or streamed navigation can be exercised under each. A non-React renderer must declare its islands capability to use that mode. [Compare the two builds](https://github.com/farming-labs/farm.js/tree/v0.1.87/examples/server-components)

One small performance result captures the trade-off. Moving the route matcher out of the initial islands entry reduced that benchmark’s Brotli-compressed entry from 11,423 to 9,738 bytes. A visit that subsequently navigated loaded **440 more bytes in total** across the two steps. The benefit was for a reader who opened the page and stayed there. The benchmark records that trade-off for the dashboard probe. [Benchmark setup, controls, and results](https://github.com/farming-labs/farm.js/blob/v0.1.87/rfcs/0013-smaller-islands-runtime.md)

<span id="what-the-farm-react-compiler-does-on-a-click" className="blog-heading-anchor" />

## What the Farm React compiler does on a click

Imagine a counter displaying `Count: 4`. Its next click changes one text node. If Farm's ahead-of-time compiler can prove which state cell supplies that text and which DOM node receives it, it can prepare that binding at build time. A local update then patches the binding. When the component depends on behavior the compiler cannot prove safe, ordinary React reconciliation handles the update.

Here is the kind of component that gives the compiler a small, checkable job:

```tsx
"use client";

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

React still owns the event in an ordinary hydrated React root. The optimization concerns the work after the handler changes `count`. You can turn on the build report below to see which components your build selected.

The built-in React renderer works with no compiler config. Install `@farm.js/react` when you want to configure the transform. This spelling already works in the 0.1 series:

```ts
import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

export default defineConfig({
  renderer: react({ compiler: { report: true } }),
});
```

| Choice          | Default                 | When to change it                                                                                                                                                  |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compiler`      | Omitted or `false`: off | `true` enables inference with safe fallback. An options object enables it with your overrides.                                                                     |
| `mode`          | `"infer"`               | Choose `"annotation"` to select components deliberately. Its default directive is `"use compiler"`; `directive` can rename it in annotation mode.                  |
| `onUnsupported` | `"fallback"`            | Use `"warn"` for diagnostics or `"error"` to fail a build on unsupported selected code.                                                                            |
| `reactivity`    | `"hybrid"`              | Hybrid can narrow subscriptions at runtime. `"static"` uses the dependencies determined at build time.                                                             |
| `report`        | `false`                 | Enable it to inspect coverage after a production build. The default file is `.farm/react-compiler.json`; `reportFile` supplies another path and enables reporting. |
| `compiledRoot`  | `true` when compiling   | Lets eligible, fully compiled, app-owned `createRoot` roots mount without React DOM. Set it to `false` to retain React DOM for those roots.                        |

For an older app, replace `react({ experimental: { compiler: true } })` with `react({ compiler: true })`. The current beta accepts the old spelling with a warning; supplying both is an error. The renderer package has its own release version. Upgrade the compiler and its runtime together and rebuild the server and client output. Enabling server components does not enable this transform, and you can use the compiler with ordinary React pages. [Compiler options and compatibility](https://farmjs.dev/docs/renderers/react#aot-compiler)

<span id="bring-your-own-renderer" className="blog-heading-anchor" />

## Bring your own renderer

I built Leaf, a small TypeScript UI library, to see where Farm still assumed React was installed. Its adapter tells Farm how to compile a `.leaf` file, render the component as HTML, and hydrate it in a browser. A Leaf page can now contain two copies of a client component, each keeping its own state as an island. Third-party authors can install the renderer conformance suite from npm and run it against their own adapters. [Build a renderer](https://farmjs.dev/blog/bring-your-own-renderer)

You can try that without building Farm itself. Use Node 22.13 or later and pnpm 8.12.1:

```sh
git clone https://github.com/farming-labs/leaf
cd leaf
git checkout --detach 7da8b6a
pnpm install --frozen-lockfile
pnpm dev
```

Open `/islands/leaf` at the address printed by the dev server. Click one planter, then the other. Each count belongs to the button you clicked. [Example source](https://github.com/farming-labs/leaf/tree/7da8b6a)

<span id="an-agent-can-read-part-of-a-page-or-wait-an-hour-for-an-event" className="blog-heading-anchor" />

## An agent can read part of a page or wait an hour for an event

For a complete walkthrough, read [Build durable agents with your framework and Farm Infra](https://farmjs.dev/blog/durable-agents). It shows the agent code, how to mount it in an existing app, and how to choose hosted storage, wake-ups, and approvals.

Try these against the running docs site:

```sh
curl -fsS 'https://farmjs.dev/docs/renderers.md?outline'
curl -fsS 'https://farmjs.dev/.well-known/farmjs.json'
```

The first returns the page outline. A reader can ask for a section or follow a continuation link through a longer page with a token budget. The second describes the app and its tools. Public Farm apps can expose a read-only MCP server for their public pages, and app authors can separately expose server functions and queries as tools. A private app upgrading from early 0.1 should review these defaults, including which route metadata appears in its indexes. [Markdown reads](https://farmjs.dev/docs/markdown) · [Upgrade guide](https://farmjs.dev/docs/upgrading)

Running an agent introduces a different problem. Our checkout example reaches the point where it needs a payment result. An HTTP request is a poor place to spend the next hour waiting. With `@farm.js/agent`, the run records what it is waiting for:

```ts
const payment = await run.waitFor<{ orderId: string; amount: number }>("payment.succeeded", {
  match: { orderId: input.orderId },
  timeout: "1h",
});
```

A verified payment event can resume the matching order. An approval can pause a run across a deployment, and a disconnected client can reconnect from its last event. Use persistent run storage for that deployment. The integration uses agent-unit and works with plain TypeScript agents as well as supported agent SDKs. [Durable agents and event delivery](https://farmjs.dev/docs/integrations/agent)

<span id="farm-infra" className="blog-heading-anchor" />

## Farm Infra, from a checkout preview to a production incident

In the 0.1 announcement, we asked people to join a waitlist for agent infrastructure. Now you can open Farm Infra and use it with an app on your existing host. Think of a checkout feature you want someone else to try. The first thing you need is a URL. Later you might need to answer a harder question: did a payment event arrive, did your app process it, and is a refund waiting for someone to approve it? Here’s what the initial Infra offering covers. [Open Farm Infra](https://app.farmjs.dev/) · [Original announcement](https://farmjs.dev/blog/0.1.0#agent-infrastructure)

### Share the running app

Start the app with `farm dev --port 3000`. In a second terminal, run:

```sh
farm preview --port 3000 --name checkout-review --expires 30m
```

The CLI prints a public URL and a dashboard link for that session. A teammate can try the checkout while you watch the request path, HTTP status, and response time in **Previews**. You can stop sharing from the dashboard and keep developing locally. The tunnel needs the local app and CLI to stay running. This is also how we shared the draft of this post. [Farm Preview guide](https://farmjs.dev/docs/preview)

### Find out what reached the app

**Projects and Overview.** Sign up with GitHub, Google, or email to get a workspace. Connect the app directory in a GitHub repository, including one in a monorepo. Your deployment stays on its current host. To start analytics, give the server a project-scoped `FARMJS_API_KEY` with `analytics:write`. Overview then shows requests, tool calls, and changes from the preceding period. Switch between development, staging, and production to investigate the right traffic. [Analytics setup](https://farmjs.dev/docs/infra-analytics)

**Agent traffic and tool calls.** A browser can visit checkout, a crawler can read its Markdown, and an MCP client can call a tool. The activity explorer lets you filter by route, client, status, and duration. Open a tool to see its schema, calls, and failures. A tool can fail inside a successful HTTP 200 response, which is a good reason to inspect the tool outcome itself. Server MCP calls and browser-reported WebMCP calls have separate views. Tool details can include arguments and results with recognized secret fields redacted. Set `FARMJS_TOOL_PAYLOADS=off` to keep the counts and timings without sending those values. Where enabled, **Ask AI** answers questions about usage from the records the workspace member can read. [Tool-call details and payload settings](https://farmjs.dev/docs/infra-analytics#tool-call-payloads)

**Site audit.** You can enter a public URL before you instrument the app. The audit checks what an agent can discover and read, including Markdown, robots rules, sitemaps, OpenAPI, and MCP discovery. Each report points to changes you can make. Monitor a site to compare scores and see which checks changed on later scans. The beta supports five sites per organization, with daily, weekly, monthly, or custom intervals. [Try the public check](https://farmjs.dev/agents/check)

### Follow the payment after the browser closes

| When you need to…                   | What Infra gives you                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receive a payment event             | **Webhooks** gives the provider an HTTPS endpoint. For example, configure Stripe’s signing secret, receive its event, and follow each delivery attempt to your app. Inspect a failed event and replay it after fixing the handler. A development receiver can point to an active Farm Preview. [Webhook guide](https://farmjs.dev/docs/integrations/webhooks)                                                                               |
| Reconcile orders every night        | **Cron jobs** calls a deployed route on its UTC schedule. Choose the `farmjs` provider, review changes with `farm cron sync --url https://shop.example.com`, then add `--apply` to register them. The dashboard shows the next run, past attempts, and retries after failure. [Cron guide](https://farmjs.dev/docs/cron#run-by-farmjs-infra)                                                                                                |
| Save order records or a cursor      | **Storage** hosts named SQL and key-value resources backed by libSQL. Declare a mount with `farmStorage({ type: "sql" })` or `farmStorage({ type: "kv" })`, inspect `farm storage plan`, then provision with `farm storage apply`. In the console, pick the project and environment to browse keys, SQL rows, table schemas, and relations. [Managed storage guide](https://farmjs.dev/docs/storage#hosted-by-farmjs-infra)                 |
| Get a person’s decision on a refund | **Agents** works with durable runs in your app. Infra can store run state, wake a parked run with a signed callback, and show pending approvals. An authorized reviewer can approve, reject, or cancel. Teams can send approval notifications to Slack, Discord, or Telegram, or send signed approval events to their own webhook and inspect its delivery history. [Durable agent integration](https://farmjs.dev/docs/integrations/agent) |

**Workspace access.** Invite teammates to the organization and give them the project access their role needs. API keys can be scoped by project and permission, assigned an expiry, and revoked. That lets a CI job open previews with its own key and a production app report analytics with another. Account settings manage linked sign-ins and chat identities. [Farm Infra dashboard](https://app.farmjs.dev/dashboard)

<span id="the-rest-of-the-release-matters-when-you-operate-the-app" className="blog-heading-anchor" />

## The rest of the release matters when you operate the app

- **Data and integrations.** Plugins can declare tables and dependencies, check them against a live database, and plan schema migrations. Convex and Strapi gained dedicated integrations, including schema-aware Strapi types. [Storage](https://farmjs.dev/docs/storage) · [Convex](https://farmjs.dev/docs/integrations/convex) · [Strapi](https://farmjs.dev/docs/integrations/strapi)
- **Background work.** Jobs can also run through a local or custom runtime. For apps that handle deliveries themselves, the framework includes helpers to verify incoming events and sign outgoing ones. [Webhook guide](https://farmjs.dev/docs/integrations/webhooks)
- **Seeing what happened.** DevTools exposes plugin order and hooks. The analyzer can find broken internal links after a build.
- **Everyday web work.** Development and production builds share Vite 8. There are typed JSON-LD helpers, generated social images, opt-in docs prerendering, navigation announcements for screen readers, and plugins for prefetch, navigation progress, and scroll restoration. [Prefetch](https://farmjs.dev/docs/plugins/prefetch) · [Scroll restoration](https://farmjs.dev/docs/plugins/scroll-restoration)

If you’re upgrading an existing app, start with its config. Keep the current rendering mode explicit when migrating, then enable the React compiler report if you want to see which client updates Farm can compile. For a new service, try the todo API first. You can send it a request before you decide whether your app needs a web page or a native screen. [Upgrade guide](https://farmjs.dev/docs/upgrading) · [Todo API](https://github.com/farming-labs/farm.js/tree/v0.1.87/examples/api-server) · [Mobile example](https://github.com/farming-labs/farm.js/tree/v0.1.87/examples/mobile)
