---
title: "Safe Fetch"
description: "Fetch URLs your server didn't choose without letting them reach private networks."
section: "Runtime"
---

# Safe Fetch

**`safeFetch` is a `fetch` for URLs that come from users**, such as a webhook endpoint, a feed to import, or a page to preview. It refuses to connect to private networks, so a URL like `http://169.254.169.254/` can't read your cloud credentials or reach an internal service.

```ts
import { safeFetch } from "@farm.js/core/safe-fetch";

const response = await safeFetch(userUrl, { signal: AbortSignal.timeout(5_000) });
```

It takes the same arguments and returns the same `Response` as `fetch`. Farm's image optimizer uses it for remote images.

## What it refuses

Every refusal is a `SafeFetchError` with a stable `code`:

| `code`                 | When                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ADDRESS_BLOCKED`      | The host is, or resolves to, a private, loopback, link-local, carrier-grade NAT, documentation, multicast or reserved address |
| `PROTOCOL_NOT_ALLOWED` | The URL isn't `http:` or `https:`                                                                                             |
| `CREDENTIALS_IN_URL`   | The URL has a username or password                                                                                            |
| `PORT_NOT_ALLOWED`     | The port isn't in `allowedPorts`                                                                                              |
| `INVALID_URL`          | The URL, or a redirect's `Location`, isn't a valid absolute URL                                                               |
| `DNS_FAILED`           | The host didn't resolve; `cause` holds the resolver's error                                                                   |
| `REDIRECT_NOT_ALLOWED` | The response redirected and the request set `redirect: "error"`                                                               |
| `TOO_MANY_REDIRECTS`   | More redirects than `maxRedirects`                                                                                            |
| `INVALID_RESPONSE`     | The server answered with a status outside 200-599                                                                             |
| `UNSUPPORTED_RUNTIME`  | The app isn't running on Node; see [Runtimes](#runtimes)                                                                      |

```ts
import { safeFetch, SafeFetchError } from "@farm.js/core/safe-fetch";

try {
  await safeFetch(endpoint, { method: "POST", body });
} catch (error) {
  if (error instanceof SafeFetchError && error.code === "ADDRESS_BLOCKED") {
    return Response.json({ error: "That URL points to a private network." }, { status: 400 });
  }
  throw error;
}
```

IPv6 forms that carry a private IPv4 address are refused too, such as `::ffff:127.0.0.1`, NAT64 `64:ff9b::a9fe:a9fe` and 6to4 `2002:7f00:1::`. To check an address yourself, use `isPrivateAddress(address)`.

## How it checks

- **At connect time.** The address is checked by the same lookup that picks the address to connect to. A hostname can't pass the check and then resolve somewhere private (DNS rebinding).
- **Every address.** A host with one public and one private address is refused.
- **Every redirect.** Each hop is checked like the first URL. A redirect to another origin drops `authorization`, `cookie` and `proxy-authorization`.
- **A fresh connection each time.** Pooled sockets skip the lookup, so `safeFetch` never reuses one.

Everything else is plain `fetch`: pass a `signal` for a timeout, and read and limit the body yourself. Request bodies are buffered, so a 307 or 308 redirect can send them again.

## Options

`createSafeFetch(options)` returns a configured `fetch`. `safeFetch` is `createSafeFetch()`.

```ts
import { createSafeFetch } from "@farm.js/core/safe-fetch";

const fetchWebhook = createSafeFetch({ allowedPorts: [443], maxRedirects: 0 });
```

| Option                      | Default             | Meaning                                                                                                                 |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `allowedPorts`              | any port            | Ports a URL may use, including after a redirect                                                                         |
| `maxRedirects`              | `20`, like `fetch`  | Redirects followed for `redirect: "follow"`                                                                             |
| `lookup`                    | the system resolver | `(hostname) => Promise<{ address, family }[]>`. Every address it returns must be public                                 |
| `dangerouslyAllowAddresses` | none                | IP addresses to allow even though they're private, such as `127.0.0.1` for a test server. Never fill it from user input |

## Runtimes

`safeFetch` runs on Node. It checks addresses in `node:http`'s `lookup` hook, and Bun 1.2 doesn't call that hook, so on Bun, Deno and Cloudflare Workers it throws `UNSUPPORTED_RUNTIME` instead of fetching unchecked. Import it only from server code.

On Bun, the [image optimizer](/docs/images) checks a remote image's addresses before each request instead, so it isn't protected against DNS rebinding there.
