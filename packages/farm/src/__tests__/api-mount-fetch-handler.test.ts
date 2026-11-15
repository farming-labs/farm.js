// @vitest-environment node

import { Elysia } from "elysia";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { API_ROUTE_METHODS, mountFetchHandler } from "../api";

/** Answers with what the mounted app received. */
async function describeRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return Response.json({
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    header: request.headers.get("x-test"),
    body: request.body ? await request.text() : null,
  });
}

describe("mountFetchHandler", () => {
  it("returns one handler for every API route method", () => {
    const handlers = mountFetchHandler(describeRequest);
    expect(Object.keys(handlers).sort()).toEqual([...API_ROUTE_METHODS].sort());
  });

  it("passes the request through unchanged by default", async () => {
    const request = new Request("http://localhost/api/app/users/1?x=1");
    let received: Request | undefined;
    const { GET } = mountFetchHandler((incoming) => {
      received = incoming;
      return new Response("ok");
    });

    await GET(request, { params: Promise.resolve({ path: ["users", "1"] }) });
    expect(received).toBe(request);
  });

  it("calls an app's fetch method with the app as `this`", async () => {
    class App {
      prefix = "app";
      fetch(request: Request) {
        return new Response(`${this.prefix}:${new URL(request.url).pathname}`);
      }
    }
    const { GET } = mountFetchHandler(new App());

    const response = await GET(new Request("http://localhost/api/app/a"));
    await expect(response.text()).resolves.toBe("app:/api/app/a");
  });

  it("accepts Hono and Elysia apps as they are typed and built", async () => {
    const hono = new Hono().get("/app/hi", (c) => c.text("hono"));
    const elysia = new Elysia().get("/app/hi", () => "elysia");

    for (const [app, body] of [
      [mountFetchHandler(hono), "hono"],
      [mountFetchHandler(elysia), "elysia"],
    ] as const) {
      const response = await app.GET(new Request("http://localhost/app/hi"));
      await expect(response.text()).resolves.toBe(body);
    }
  });

  it("strips the mount path and keeps the query and raw segment encoding", async () => {
    const { GET } = mountFetchHandler(describeRequest, { stripMountPath: true });

    const response = await GET(new Request("http://localhost/api/app/a%20b/c%2Fd?x=1&x=2"), {
      params: Promise.resolve({ path: ["a b", "c/d"] }),
    });
    await expect(response.json()).resolves.toMatchObject({
      pathname: "/a%20b/c%2Fd",
      search: "?x=1&x=2",
    });
  });

  it("keeps a trailing slash and finds the catch-all among other params", async () => {
    const { GET } = mountFetchHandler(describeRequest, { stripMountPath: true });

    const response = await GET(new Request("http://localhost/api/orgs/acme/app/users/"), {
      params: { org: "acme", rest: ["users"] },
    });
    await expect(response.json()).resolves.toMatchObject({ pathname: "/users/" });
  });

  it("hands the app the root when the route has no catch-all segments", async () => {
    const { GET } = mountFetchHandler(describeRequest, { stripMountPath: true });

    for (const params of [undefined, {}, { path: [] }, { id: "1" }]) {
      const response = await GET(new Request("http://localhost/api/app/"), { params });
      await expect(response.json()).resolves.toMatchObject({ pathname: "/" });
    }
  });

  it("forwards the method, headers and body of a stripped request", async () => {
    const { POST } = mountFetchHandler(describeRequest, { stripMountPath: true });

    const response = await POST(
      new Request("http://localhost/api/app/echo", {
        method: "POST",
        headers: { "x-test": "yes", "content-type": "text/plain" },
        body: "hello",
      }),
      { params: Promise.resolve({ path: ["echo"] }) },
    );
    await expect(response.json()).resolves.toEqual({
      method: "POST",
      pathname: "/echo",
      search: "",
      header: "yes",
      body: "hello",
    });
  });
});
