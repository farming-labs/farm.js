// @vitest-environment node
import {
  createServer,
  get as httpGet,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNodeImageFetcher } from "../image-sharp";
import {
  createSafeFetch,
  isPrivateAddress,
  SafeFetchError,
  type SafeFetchLookup,
} from "../safe-fetch";

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

let server: Server;
let port: number;
const seen: Seen[] = [];
let handle: (request: IncomingMessage, response: ServerResponse, body: string) => void;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: request.method!, url: request.url!, headers: request.headers, body });
      handle(request, response, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

/** Public-looking hostnames that all reach the local test server, and one that is internal. */
const hosts: Record<string, string> = {
  "a.test": "127.0.0.1",
  "b.test": "127.0.0.1",
  "internal.test": "10.0.0.5",
  "mixed.test": "127.0.0.1",
};
const lookup: SafeFetchLookup = async (hostname) => {
  if (hostname === "mixed.test") {
    return [
      { address: "127.0.0.1", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ];
  }
  const address = hosts[hostname];
  if (!address) throw new Error(`ENOTFOUND ${hostname}`);
  return [{ address, family: 4 }];
};

// The test server listens on loopback, so only that one address is let through.
const fetchSafely = createSafeFetch({ lookup, dangerouslyAllowAddresses: ["127.0.0.1"] });
const at = (host: string, path = "/") => `http://${host}:${port}${path}`;

async function refusal(promise: Promise<unknown>): Promise<SafeFetchError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SafeFetchError);
  return error as SafeFetchError;
}

describe("createSafeFetch", () => {
  it("fetches a public host like fetch does", async () => {
    handle = (_request, response) => {
      response.setHeader("content-type", "text/plain");
      response.end("hello");
    };
    const response = await fetchSafely(at("a.test", "/hi"), { headers: { "x-test": "1" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.url).toBe(at("a.test", "/hi"));
    expect(response.redirected).toBe(false);
    expect(await response.text()).toBe("hello");
    expect(seen.at(-1)).toMatchObject({ method: "GET", url: "/hi" });
    expect(seen.at(-1)!.headers["x-test"]).toBe("1");
    expect(seen.at(-1)!.headers["accept-encoding"]).toBe("identity");
  });

  it("refuses a hostname that resolves to a private address, before connecting", async () => {
    const before = seen.length;
    const error = await refusal(fetchSafely("http://internal.test/"));
    expect(error.code).toBe("ADDRESS_BLOCKED");
    expect(error.message).toContain("10.0.0.5");
    expect(seen.length).toBe(before);
  });

  it("refuses a host when any of its addresses is private", async () => {
    const error = await refusal(fetchSafely(at("mixed.test")));
    expect(error.code).toBe("ADDRESS_BLOCKED");
    expect(error.message).toContain("192.168.1.10");
  });

  it("refuses private IP literals, which never reach the lookup", async () => {
    const spy = vi.fn(lookup);
    const fetchStrict = createSafeFetch({ lookup: spy });
    for (const url of [
      `http://127.0.0.1:${port}/`,
      "http://169.254.169.254/latest/meta-data/",
      "http://[::ffff:7f00:1]/",
      "http://[64:ff9b::a9fe:a9fe]/",
    ]) {
      expect((await refusal(fetchStrict(url))).code).toBe("ADDRESS_BLOCKED");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("connects to the address it checked, so the answer can't change in between", async () => {
    handle = (_request, response) => response.end("ok");
    let calls = 0;
    // A rebinding resolver: public the first time, private after that.
    const rebinding: SafeFetchLookup = async () => {
      calls += 1;
      return [{ address: calls === 1 ? "127.0.0.1" : "10.0.0.1", family: 4 }];
    };
    const fetchOnce = createSafeFetch({
      lookup: rebinding,
      dangerouslyAllowAddresses: ["127.0.0.1"],
    });
    const response = await fetchOnce(at("a.test"));
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(1);
  });

  it("never reuses a pooled socket it didn't check", async () => {
    handle = (_request, response) => response.end("ok");
    // Other code in the app opens a keep-alive socket to the host through Node's shared pool.
    await new Promise<void>((resolve, reject) => {
      httpGet(
        {
          host: "a.test",
          port,
          lookup: (_hostname, options, callback) =>
            options.all
              ? callback(null, [{ address: "127.0.0.1", family: 4 }])
              : callback(null, "127.0.0.1", 4),
        },
        (response) => {
          response.resume();
          response.on("end", resolve);
        },
      ).on("error", reject);
    });
    // The host now resolves somewhere private; that socket must not be used.
    const fetchStrict = createSafeFetch({
      lookup: async () => [{ address: "10.0.0.1", family: 4 }],
    });
    expect((await refusal(fetchStrict(at("a.test")))).code).toBe("ADDRESS_BLOCKED");
  });

  it("refuses unsafe URLs with a code for each reason", async () => {
    expect((await refusal(fetchSafely("file:///etc/passwd"))).code).toBe("PROTOCOL_NOT_ALLOWED");
    expect((await refusal(fetchSafely("http://user:pass@a.test/"))).code).toBe(
      "CREDENTIALS_IN_URL",
    );
    expect((await refusal(fetchSafely("/relative"))).code).toBe("INVALID_URL");
    const fetchWebPorts = createSafeFetch({ lookup, allowedPorts: [80, 443] });
    expect((await refusal(fetchWebPorts(at("a.test")))).code).toBe("PORT_NOT_ALLOWED");
  });

  it("reports a failed lookup as DNS_FAILED with the cause", async () => {
    const error = await refusal(fetchSafely("http://missing.test/"));
    expect(error.code).toBe("DNS_FAILED");
    expect(String(error.cause)).toContain("ENOTFOUND");
  });

  it("checks every redirect and refuses one to a private address", async () => {
    handle = (_request, response) => {
      response.writeHead(302, { location: "http://internal.test/admin" });
      response.end();
    };
    const error = await refusal(fetchSafely(at("a.test")));
    expect(error.code).toBe("ADDRESS_BLOCKED");
    expect(error.url).toBe("http://internal.test/admin");

    handle = (_request, response) => {
      response.writeHead(307, { location: "http://[::1]/" });
      response.end();
    };
    expect((await refusal(fetchSafely(at("a.test")))).code).toBe("ADDRESS_BLOCKED");

    handle = (_request, response) => {
      response.writeHead(301, { location: "gopher://a.test/" });
      response.end();
    };
    expect((await refusal(fetchSafely(at("a.test")))).code).toBe("PROTOCOL_NOT_ALLOWED");
  });

  it("follows redirects like fetch: method, body and credentials", async () => {
    handle = (request, response) => {
      if (request.url === "/see-other") {
        response.writeHead(303, { location: "/done" });
      } else if (request.url === "/temporary") {
        response.writeHead(307, { location: at("b.test", "/done") });
      } else {
        response.writeHead(200);
      }
      response.end();
    };

    seen.length = 0;
    const seeOther = await fetchSafely(at("a.test", "/see-other"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer one" },
      body: '{"a":1}',
    });
    expect(seeOther.url).toBe(at("a.test", "/done"));
    expect(seeOther.redirected).toBe(true);
    expect(seen.map(({ method, url, body }) => [method, url, body])).toEqual([
      ["POST", "/see-other", '{"a":1}'],
      ["GET", "/done", ""],
    ]);
    // Same origin, so the credential stays; the body's headers go with the body.
    expect(seen[1]!.headers.authorization).toBe("Bearer one");
    expect(seen[1]!.headers["content-type"]).toBeUndefined();

    seen.length = 0;
    const temporary = await fetchSafely(at("a.test", "/temporary"), {
      method: "PUT",
      headers: { authorization: "Bearer two", cookie: "session=1", "x-keep": "yes" },
      body: "payload",
    });
    expect(temporary.url).toBe(at("b.test", "/done"));
    expect(seen.map(({ method, url, body }) => [method, url, body])).toEqual([
      ["PUT", "/temporary", "payload"],
      ["PUT", "/done", "payload"],
    ]);
    // A different origin: credentials are dropped, other headers stay.
    expect(seen[1]!.headers.authorization).toBeUndefined();
    expect(seen[1]!.headers.cookie).toBeUndefined();
    expect(seen[1]!.headers["x-keep"]).toBe("yes");
  });

  it("honors redirect: manual and error, and maxRedirects", async () => {
    handle = (_request, response) => {
      response.writeHead(302, { location: "/again" });
      response.end();
    };
    const manual = await fetchSafely(at("a.test"), { redirect: "manual" });
    expect(manual.status).toBe(302);
    expect(manual.headers.get("location")).toBe("/again");

    expect((await refusal(fetchSafely(at("a.test"), { redirect: "error" }))).code).toBe(
      "REDIRECT_NOT_ALLOWED",
    );

    seen.length = 0;
    const limited = createSafeFetch({
      lookup,
      dangerouslyAllowAddresses: ["127.0.0.1"],
      maxRedirects: 2,
    });
    expect((await refusal(limited(at("a.test")))).code).toBe("TOO_MANY_REDIRECTS");
    expect(seen.length).toBe(3);
  });

  it("decodes a compressed body the caller asked for", async () => {
    handle = (_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip" });
      response.end(gzipSync("compressed"));
    };
    const response = await fetchSafely(at("a.test"), { headers: { "accept-encoding": "gzip" } });
    expect(await response.text()).toBe("compressed");
  });

  it("rejects with the signal's reason when aborted", async () => {
    handle = () => {
      // Never answers; the signal ends the request.
    };
    const reason = new Error("stop");
    const controller = new AbortController();
    const pending = fetchSafely(at("a.test"), { signal: controller.signal });
    await vi.waitFor(() => expect(seen.at(-1)?.url).toBe("/"));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    handle = (_request, response) => response.end();
  });

  it("refuses to fetch on a runtime that skips the lookup hook", async () => {
    const before = seen.length;
    Object.defineProperty(process.versions, "bun", { value: "1.2.3", configurable: true });
    try {
      const error = await refusal(fetchSafely(at("a.test")));
      expect(error.code).toBe("UNSUPPORTED_RUNTIME");
      expect(error.message).toContain("Bun");
    } finally {
      delete (process.versions as Record<string, string | undefined>).bun;
    }
    expect(seen.length).toBe(before);
  });

  it("leaves the image optimizer's fetch working on Bun, where its pre-request check applies", async () => {
    handle = (_request, response) => response.end("image");
    Object.defineProperty(process.versions, "bun", { value: "1.2.3", configurable: true });
    try {
      const fetchImage = createNodeImageFetcher({ dangerouslyAllowLocalIP: false });
      const response = await fetchImage(`http://127.0.0.1:${port}/a.png`);
      expect(await response.text()).toBe("image");
    } finally {
      delete (process.versions as Record<string, string | undefined>).bun;
    }
  });

  it("accepts a Request as input", async () => {
    handle = (request, response) => response.end(`${request.method} ${request.url}`);
    const response = await fetchSafely(
      new Request(at("a.test", "/from-request"), { method: "DELETE" }),
    );
    expect(await response.text()).toBe("DELETE /from-request");
  });
});

describe("isPrivateAddress", () => {
  it("covers the special-purpose ranges a server fetch must not reach", () => {
    const blocked = [
      "192.0.2.1",
      "192.88.99.1",
      "198.51.100.7",
      "203.0.113.9",
      "100::1",
      "2001::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "2001:db8::1",
      "fec0::1",
    ];
    expect(blocked.filter((address) => !isPrivateAddress(address))).toEqual([]);
    const allowed = ["192.88.98.1", "198.51.101.1", "203.0.114.1", "2001:4860:4860::8888"];
    expect(allowed.filter((address) => isPrivateAddress(address))).toEqual([]);
  });
});
