import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anyApi } from "convex/server";

import { setConvexRuntime } from "../runtime.js";
import { fetchMutation, fetchQuery, preloadQuery } from "../server.js";
import { startRecordingServer } from "./recording-server.js";

import type { RecordingServer } from "./types.js";

const TOKENS_BY_COOKIE: Record<string, string> = {
  "session=ada": "token-for-ada",
  "session=grace": "token-for-grace",
};

function readAuthorization(convexBackend: RecordingServer, path: string): (string | undefined)[] {
  return convexBackend.requests
    .filter((request) => JSON.parse(request.body).path === path)
    .map((request) => request.headers.authorization);
}

describe("Convex server helpers", () => {
  let convexBackend: RecordingServer;

  beforeAll(async () => {
    convexBackend = await startRecordingServer((request, response) => {
      const { path, args } = JSON.parse(request.body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ status: "success", value: { path, args: args[0] }, logLines: [] }),
      );
    });
    setConvexRuntime({
      url: convexBackend.url,
      siteURL: convexBackend.url,
      token: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
        return TOKENS_BY_COOKIE[request.headers.get("cookie") ?? ""];
      },
    });
  });

  afterAll(() => convexBackend.close());

  it("runs a query with its arguments", async () => {
    const result = await fetchQuery(anyApi.courses.list, { limit: 3 });
    expect(result).toEqual({ path: "courses:list", args: { limit: 3 } });
  });

  it("never mixes up tokens between requests running at the same time", async () => {
    const visitors = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? "session=ada" : "session=grace",
    );
    await Promise.all(
      visitors.map((cookie) =>
        fetchQuery(
          anyApi.profile.read,
          { cookie },
          { request: new Request("https://app.example.com/", { headers: { cookie } }) },
        ),
      ),
    );
    const requests = convexBackend.requests.filter(
      (request) => JSON.parse(request.body).path === "profile:read",
    );
    requests.forEach((request) => {
      const cookie = JSON.parse(request.body).args[0].cookie;
      expect(request.headers.authorization).toBe(`Bearer ${TOKENS_BY_COOKIE[cookie]}`);
    });
    expect(requests).toHaveLength(20);
  });

  it("reads the visitor's token once per request, however many queries the page runs", async () => {
    let reads = 0;
    setConvexRuntime({
      url: convexBackend.url,
      siteURL: convexBackend.url,
      token: (request) => {
        reads += 1;
        return TOKENS_BY_COOKIE[request.headers.get("cookie") ?? ""];
      },
    });
    const request = new Request("https://app.example.com/", { headers: { cookie: "session=ada" } });
    await Promise.all([
      fetchQuery(anyApi.page.header, {}, { request }),
      fetchQuery(anyApi.page.body, {}, { request }),
      preloadQuery(anyApi.page.footer, {}, { request }),
    ]);
    expect(reads).toBe(1);
    expect(readAuthorization(convexBackend, "page:body")).toEqual(["Bearer token-for-ada"]);
  });

  it("sends no token for a signed-out visitor", async () => {
    await fetchMutation(
      anyApi.visits.record,
      {},
      { request: new Request("https://app.example.com/") },
    );
    expect(readAuthorization(convexBackend, "visits:record")).toEqual([undefined]);
  });

  it("prefers an explicit token over the request", async () => {
    await fetchQuery(anyApi.admin.report, {}, { token: "explicit-token" });
    expect(readAuthorization(convexBackend, "admin:report")).toEqual(["Bearer explicit-token"]);
  });

  it("preloads a query in the shape usePreloadedQuery reads", async () => {
    const preloaded = await preloadQuery(anyApi.courses.read, { slug: "convex" });
    expect(preloaded).toEqual({
      _name: "courses:read",
      _argsJSON: { slug: "convex" },
      _valueJSON: { path: "courses:read", args: { slug: "convex" } },
    });
  });
});
