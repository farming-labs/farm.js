import { isConnectLookupSupported } from "./connect-lookup-support";
import { isPrivateAddress } from "./private-address";

export { isPrivateAddress } from "./private-address";

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "PROTOCOL_NOT_ALLOWED"
  | "CREDENTIALS_IN_URL"
  | "PORT_NOT_ALLOWED"
  | "DNS_FAILED"
  | "ADDRESS_BLOCKED"
  | "REDIRECT_NOT_ALLOWED"
  | "TOO_MANY_REDIRECTS"
  | "INVALID_RESPONSE"
  | "UNSUPPORTED_RUNTIME";

/** Why a safe fetch refused a URL or could not finish. `url` is the URL it was handling. */
export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly url: string | undefined;
  /** The underlying error, such as the DNS failure. */
  declare readonly cause?: unknown;

  constructor(
    code: SafeFetchErrorCode,
    message: string,
    options: { url?: string; cause?: unknown } = {},
  ) {
    super(message);
    if (options.cause !== undefined) this.cause = options.cause;
    this.name = "SafeFetchError";
    this.code = code;
    this.url = options.url;
  }
}

export interface SafeFetchAddress {
  address: string;
  family: number;
}

/** Resolves a hostname to every address it points at. */
export type SafeFetchLookup = (hostname: string) => Promise<readonly SafeFetchAddress[]>;

export interface SafeFetchOptions {
  /** Ports a URL may use, including after a redirect. Default: any port. */
  allowedPorts?: readonly number[];
  /**
   * Redirects followed for a request with `redirect: "follow"`, the default. Each one is checked
   * like the first URL. Default 20, the same as `fetch`.
   */
  maxRedirects?: number;
  /** Resolves hostnames. Default: the system resolver. Every address it returns must be public. */
  lookup?: SafeFetchLookup;
  /**
   * IP addresses to connect to even though they are private, such as `127.0.0.1` for a test
   * server. Never fill this from user input.
   */
  dangerouslyAllowAddresses?: readonly string[];
}

type NodeModules = {
  http: typeof import("node:http");
  https: typeof import("node:https");
  isIP: typeof import("node:net").isIP;
  Readable: typeof import("node:stream").Readable;
  zlib: typeof import("node:zlib");
  dnsLookup: typeof import("node:dns").promises.lookup;
};

let nodeModules: Promise<NodeModules> | undefined;

function unsupportedRuntime(cause?: unknown): SafeFetchError {
  return new SafeFetchError(
    "UNSUPPORTED_RUNTIME",
    "`safeFetch` runs on Node only. It checks each address in `node:http`'s `lookup` hook, which Bun doesn't call and Deno and Cloudflare Workers aren't verified to call, so the check could be skipped.",
    { cause },
  );
}

// Loaded on the first call, so importing this module costs nothing on any runtime.
function loadNodeModules(): Promise<NodeModules> {
  nodeModules ??= Promise.all([
    import("node:http"),
    import("node:https"),
    import("node:net"),
    import("node:stream"),
    import("node:zlib"),
    import("node:dns"),
  ]).then(
    ([http, https, net, stream, zlib, dns]) => ({
      http,
      https,
      isIP: net.isIP,
      Readable: stream.Readable,
      zlib,
      dnsLookup: dns.promises.lookup,
    }),
    (cause) => {
      nodeModules = undefined;
      throw unsupportedRuntime(cause);
    },
  );
  return nodeModules;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
// Removed when a redirect leaves the origin, so a credential only reaches the host it was meant for.
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];
// Describe a request body; dropped with the body when a redirect turns the request into a GET.
const REQUEST_BODY_HEADERS = [
  "content-type",
  "content-length",
  "content-encoding",
  "content-language",
  "content-location",
];

function checkUrl(url: URL, allowedPorts: readonly number[] | undefined): URL {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError(
      "PROTOCOL_NOT_ALLOWED",
      `Only http and https URLs can be fetched, not ${url.protocol}`,
      { url: url.href },
    );
  }
  if (url.username || url.password) {
    throw new SafeFetchError(
      "CREDENTIALS_IN_URL",
      "A URL with a username or password is not fetched. Send credentials in a header instead.",
      { url: url.href },
    );
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (allowedPorts && !allowedPorts.includes(port)) {
    throw new SafeFetchError(
      "PORT_NOT_ALLOWED",
      `Port ${port} is not in \`allowedPorts\` (${allowedPorts.join(", ")}).`,
      { url: url.href },
    );
  }
  return url;
}

function parseUrl(value: string, base?: URL): URL {
  try {
    return new URL(value, base);
  } catch (cause) {
    throw new SafeFetchError("INVALID_URL", `Not a valid absolute URL: ${value}`, {
      url: value,
      cause,
    });
  }
}

/**
 * Create a `fetch` for URLs your server didn't choose, such as a user's webhook endpoint or an
 * image to optimize. It refuses private, loopback and link-local addresses, including cloud
 * metadata at 169.254.169.254, and IPv6 forms that carry them.
 *
 * The address is checked when the connection is made, by the same lookup that picks the
 * address, so a hostname can't pass the check and then resolve somewhere private. Every
 * redirect is checked again, and a redirect to another origin drops `authorization`, `cookie`
 * and `proxy-authorization`. It runs on Node only, and refuses to fetch on other runtimes.
 *
 * Anything else follows `fetch`: pass a `signal` for a timeout, and read and limit the body
 * yourself. Request bodies are buffered so a 307 or 308 redirect can send them again.
 */
export function createSafeFetch(options: SafeFetchOptions = {}): typeof globalThis.fetch {
  const allowed = new Set(options.dangerouslyAllowAddresses ?? []);
  const maxRedirects = options.maxRedirects ?? 20;

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isConnectLookupSupported()) throw unsupportedRuntime();
    const node = await loadNodeModules();
    const lookup: SafeFetchLookup =
      options.lookup ?? ((hostname) => node.dnsLookup(hostname, { all: true, verbatim: true }));
    const isBlocked = (address: string) => isPrivateAddress(address) && !allowed.has(address);

    const source =
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    let url = checkUrl(parseUrl(source), options.allowedPorts);
    const request = new Request(input, init);
    let method = request.method;
    const headers = new Headers(request.headers);
    let body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
    // The body is passed through as it arrives, so ask for it unencoded unless the caller chose.
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");

    for (let redirects = 0; ; redirects += 1) {
      const response = await send(node, url, method, headers, body, request.signal, {
        lookup,
        isBlocked,
      });
      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return withUrl(response, url, redirects > 0);
      }
      if (request.redirect === "manual") return withUrl(response, url, redirects > 0);
      await response.body?.cancel();
      if (request.redirect === "error") {
        throw new SafeFetchError(
          "REDIRECT_NOT_ALLOWED",
          `${url.href} redirected, and the request set \`redirect: "error"\`.`,
          { url: url.href },
        );
      }
      if (redirects >= maxRedirects) {
        throw new SafeFetchError(
          "TOO_MANY_REDIRECTS",
          `More than ${maxRedirects} redirects. Raise \`maxRedirects\` if that is expected.`,
          { url: url.href },
        );
      }

      const next = checkUrl(parseUrl(location, url), options.allowedPorts);
      // As fetch does: a 303 (except to GET or HEAD), or a 301 or 302 after a POST, continues as
      // a GET without the body.
      if (
        response.status === 303
          ? method !== "GET" && method !== "HEAD"
          : (response.status === 301 || response.status === 302) && method === "POST"
      ) {
        method = "GET";
        body = undefined;
        for (const name of REQUEST_BODY_HEADERS) headers.delete(name);
      }
      if (next.origin !== url.origin) {
        for (const name of CREDENTIAL_HEADERS) headers.delete(name);
      }
      url = next;
    }
  }) as typeof globalThis.fetch;
}

/** A safe fetch with the default options. See `createSafeFetch`. */
export const safeFetch: typeof globalThis.fetch = createSafeFetch();

function withUrl(response: Response, url: URL, redirected: boolean): Response {
  Object.defineProperty(response, "url", { value: url.href });
  Object.defineProperty(response, "redirected", { value: redirected });
  return response;
}

function send(
  node: NodeModules,
  url: URL,
  method: string,
  headers: Headers,
  body: Uint8Array | undefined,
  signal: AbortSignal,
  check: { lookup: SafeFetchLookup; isBlocked: (address: string) => boolean },
): Promise<Response> {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  // Node connects to an IP address in the URL without calling `lookup`, so check it here.
  if (node.isIP(hostname) !== 0 && check.isBlocked(hostname)) {
    return Promise.reject(blocked(url, hostname, hostname));
  }

  return new Promise<Response>((resolve, reject) => {
    const nodeRequest = (url.protocol === "https:" ? node.https : node.http).request(
      url,
      {
        method,
        headers: Object.fromEntries(headers),
        signal,
        // A fresh connection every time. A pooled socket skips `lookup`, and Node's shared pool
        // holds sockets that other code opened to addresses nobody checked.
        agent: false,
        lookup(name, lookupOptions, callback) {
          const done = callback as unknown as (
            error: Error | null,
            address: string | SafeFetchAddress[],
            family?: number,
          ) => void;
          check.lookup(name).then(
            (addresses) => {
              if (addresses.length === 0) {
                done(
                  new SafeFetchError("DNS_FAILED", `${name} has no addresses`, { url: url.href }),
                  "",
                );
                return;
              }
              // Every address must be public, not only the first: a resolver may rotate between
              // them, and a mixed answer is a common way to slip in an internal one.
              const privateAddress = addresses.find(({ address }) => check.isBlocked(address));
              if (privateAddress) {
                done(blocked(url, name, privateAddress.address), "");
                return;
              }
              if ((lookupOptions as { all?: boolean }).all) {
                done(
                  null,
                  addresses.map(({ address, family }) => ({ address, family })),
                );
                return;
              }
              done(null, addresses[0]!.address, addresses[0]!.family);
            },
            (cause) => {
              done(
                new SafeFetchError("DNS_FAILED", `Could not resolve ${name}`, {
                  url: url.href,
                  cause,
                }),
                "",
              );
            },
          );
        },
      },
      (nodeResponse) => {
        const status = nodeResponse.statusCode ?? 0;
        if (status < 200 || status > 599) {
          nodeResponse.resume();
          reject(
            new SafeFetchError("INVALID_RESPONSE", `${url.href} answered with status ${status}`, {
              url: url.href,
            }),
          );
          return;
        }
        const responseHeaders = new Headers();
        for (let index = 0; index < nodeResponse.rawHeaders.length; index += 2) {
          responseHeaders.append(
            nodeResponse.rawHeaders[index]!,
            nodeResponse.rawHeaders[index + 1]!,
          );
        }
        let stream: import("node:stream").Readable = nodeResponse;
        const encoding = responseHeaders.get("content-encoding")?.trim().toLowerCase();
        const decoder =
          encoding === "gzip" || encoding === "x-gzip"
            ? node.zlib.createGunzip()
            : encoding === "deflate"
              ? node.zlib.createInflate()
              : encoding === "br"
                ? node.zlib.createBrotliDecompress()
                : undefined;
        if (decoder) {
          nodeResponse.once("error", (error) => decoder.destroy(error));
          stream = nodeResponse.pipe(decoder);
        }
        const responseBody =
          method === "HEAD" || NULL_BODY_STATUSES.has(status)
            ? null
            : (node.Readable.toWeb(stream) as ReadableStream<Uint8Array>);
        if (responseBody === null) nodeResponse.resume();
        resolve(
          new Response(responseBody, {
            status,
            statusText: nodeResponse.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    // Like fetch, an aborted request rejects with the signal's reason.
    nodeRequest.once("error", (error) => reject(signal.aborted ? signal.reason : error));
    nodeRequest.end(body);
  });
}

function blocked(url: URL, hostname: string, address: string): SafeFetchError {
  return new SafeFetchError(
    "ADDRESS_BLOCKED",
    hostname === address
      ? `${address} is a private address, so it is not fetched.`
      : `${hostname} resolves to ${address}, a private address, so it is not fetched.`,
    { url: url.href },
  );
}
