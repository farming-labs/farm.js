---
title: "Rust and Go API routes are in public beta"
description: "Farm now serves route.rs and route.go next to route.ts through the experimental Polyroute plugin. How to try it, how it works, what the numbers say, and what the beta does not do yet."
---

# Rust and Go API routes are in public beta

KinfeMichael Tariku · Nov 2026

You have a Rust parser that already works. Or a Go function your team has trusted for years. You want it behind `/api/parse` in your Farm app.

Until now that meant a rewrite in TypeScript, or a second service and a network hop to reach it.

**Farm now serves `route.rs` and `route.go` next to `route.ts`, through the experimental Polyroute plugin.** You write the handler in Rust or Go, put it where a TypeScript route would go, and Farm routes requests to it with the same URL rules and middleware.

This is a public beta. The feature is opt-in, the API can still change, and the verified surface is small. The rest of this post covers what that surface is, what it costs, and when it's faster.

<span id="try-it" className="blog-heading-anchor" />

## Try it

Install the Farm beta and Polyroute. The machine that builds the app needs a toolchain for each language you use. The machine that runs the build needs only Node.

```bash
pnpm add @farm.js/core@beta
pnpm add -D @farm.js/cli@beta @farming-labs/polyroute@beta

# Rust routes
rustup target add wasm32-wasip2
# Go routes need Go 1.27.1 or newer
```

Register Polyroute once, as an ordinary Vite plugin:

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { polyroute } from "@farming-labs/polyroute";

export default defineConfig({
  vite: { plugins: [polyroute()] },
});
```

Then put routes where you'd put any other route:

```text
src/app/api/
  hello/route.ts     → /api/hello
  primes/route.rs    → /api/primes
  slug/route.go      → /api/slug
       go.mod
       go.sum
```

A Go route is a `main` package with its own module. It registers a standard `net/http` handler:

```go
// src/app/api/slug/route.go
package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode"

	"go.bytecodealliance.org/wasi/wasihttp"
)

// slugify lowercases text and joins its letter and digit runs with dashes.
func slugify(text string) string {
	words := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	return strings.Join(words, "-")
}

func init() {
	wasihttp.HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		text := r.URL.Query().Get("text")
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"text": text, "slug": slugify(text)})
	})
}

func main() {}
```

Copy its `go.mod` and `go.sum` from [Polyroute's slug example](https://github.com/farming-labs/polyroute/tree/v0.1.0-beta.0/examples/polyglot/app/api/slug). The first build downloads the route's Go modules. Only `route.go` defines the URL; other `.go` files in that folder are part of the same route.

The Rust route is an async function that receives the request and answers it. The [prime-counting example](https://github.com/farming-labs/polyroute/blob/v0.1.0-beta.0/examples/polyglot/app/api/primes/route.rs) counts the primes below `limit`.

Start the dev server and call both:

```bash
farm dev

curl "localhost:3000/api/slug?text=Hello%20Farm"
# {"slug":"hello-farm","text":"Hello Farm"}

curl "localhost:3000/api/primes?limit=10"
# {"limit":10,"primes":4}
```

Edit `route.go` and the next request runs the new code, without a restart. Delete it and `/api/slug` returns 404. For production, build the Node server and deploy the whole output:

```bash
farm build --preset node-server
```

The handler decides which methods it accepts. A `POST` to `/api/slug` gets a 405 with `allow: GET`. Call these routes with `fetch`; Farm's typed API client can't infer a Rust or Go schema.

<span id="how-it-works" className="blog-heading-anchor" />

## How it works

<BlogFigure kind="polyroute-languages" caption="At build time Polyroute compiles each Rust and Go route to WebAssembly and gives Farm a Fetch handler. A request runs Farm's middleware first, then the handler." />

Polyroute owns the languages. At build time it compiles each route to a WebAssembly component, turns that component into JavaScript, and hands Farm a module that exports ordinary Fetch handlers: a web `Request` in, a `Response` out.

Farm owns everything around it. It discovers `route.rs` and `route.go` in `src/app/api`, matches the URL, and runs your middleware. Then it calls the handler the same way it calls a TypeScript one. There's no second server and no network hop between Farm and your Rust or Go code.

The compiled Wasm ships inside the server output, beside the JavaScript that loads it, and never in the public folder. Remove the plugin and Farm stops discovering these files. Apps without Polyroute install no compiler and scan only TypeScript and JavaScript routes, as before.

<span id="measured-not-claimed" className="blog-heading-anchor" />

## Measured, not claimed

The honest headline is narrower than "Rust is fast."

**Rust helps routes that compute. It doesn't help routes that wait.** A database query or a model call takes as long from Rust as it does from TypeScript, and every call into WebAssembly has a fixed cost.

Here's the same prime-counting algorithm in Rust and in TypeScript, from Polyroute's local Farm benchmark on an Apple M1. Each figure is the median of ten rounds:

| Route                | Connections | TypeScript p95 | Rust p95 |
| -------------------- | ----------: | -------------: | -------: |
| Primes below 100,000 |           1 |        6.22 ms |  3.32 ms |
| Primes below 100,000 |          10 |       57.92 ms | 35.00 ms |
| Primes below 2       |          10 |        3.08 ms |  4.06 ms |

On the heavy request, Rust cut p95 latency by 40–47%. At 10 connections it roughly doubled throughput, from 188 to 399 requests per second. On the light one, Rust was slower: there's almost no work to speed up, so the fixed cost dominates. A second, identical TypeScript server in that run varied by 17% on the light case, so treat small differences there as noise. [Method and full results](https://github.com/farming-labs/polyroute/blob/6ec6f02cac043b21be23f33e19bd5dd70a7212a8/docs/benchmarks/2026-11-26-farm-route-output.md)

I also ran it hosted. One Vercel preview in `iad1` served the Rust route, its TypeScript twin, and an identical TypeScript copy as a noise control. I sent 3,030 requests from my laptop through Vercel's San Francisco edge: five interleaved rounds of 180 measured requests per route at 10 connections, with every response checked byte for byte.

| Route                    |      p50 |      p95 |
| ------------------------ | -------: | -------: |
| Rust                     | 100.3 ms | 118.6 ms |
| TypeScript               | 105.4 ms | 122.7 ms |
| TypeScript, control copy | 104.5 ms | 123.5 ms |

Rust won the median in all five rounds, by about 5 ms. The p95 difference was too small to call. Most of each request was the trip itself: a near-empty request took about 97 ms. Rust shrank the compute, which is the small part of that request. Put a heavier computation behind the route, or a caller inside the same region, and the compute becomes a larger share of what you wait for.

Go is a reuse story today, not a speed one. Polyroute measured a Go route that does almost no work at about four times the per-request cost of TypeScript. Bring Go code you already have and trust; don't port a fast TypeScript route to Go hoping it gets faster.

So measure your own endpoint. Rust is worth trying on a route that spends most of its time computing. Leave a route that mostly waits in TypeScript.

<span id="limits-of-the-beta" className="blog-heading-anchor" />

## Limits of the beta

The verified combination is small on purpose:

- **Node server, default runtime.** We test `farm build --preset node-server` with Polyroute's default V8 WebAssembly runtime. I ran the Rust route on a Vercel preview for the numbers above, but provider presets aren't part of the verified surface yet.
- **Rust and Go.** Polyroute also compiles Python, but Farm doesn't discover `route.py` yet.
- **No inferred types.** Farm's API client generator can't read a Rust or Go handler's schema. Call these routes with `fetch`.
- **Light routes cost more.** Expect a near-empty Rust route to cost about 1.8 times a TypeScript one per request, and Go about 4 times.
- **Outbound requests need an allowlist.** A route that calls other services fails to build until you list the hosts it may reach in `polyroute({ outbound: { allow: [...] } })`.
- **Go instances are recycled.** Polyroute replaces a Go route's instance after 1,000 requests to cap memory growth, so package-level state doesn't last longer than that.
- **Go on Windows needs a manual step.** componentize-go's wrapper can't download its Windows binary yet. Polyroute's README has the one-time workaround.

The API routes guide has the [setup and the tested versions](/docs/api-routes#experimental-rust-and-go-routes). Polyroute's README covers the [languages, limits, and runtime options](https://github.com/farming-labs/polyroute#readme).

If you have Rust or Go code you'd rather call than rewrite, try it. Then tell me where it breaks: [open an issue on Farm](https://github.com/farming-labs/farm.js/issues) or [on Polyroute](https://github.com/farming-labs/polyroute/issues).
