// @vitest-environment node
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";
import { createFarmNodeRequestAbortSignal } from "../server-http";

// Execute the actual development caller, including its lazy renderPage callback.
function runtime({
  pathname = "/account.md",
  method = "GET",
  enabled = true,
  moduleRequest = false,
  destroyed = false,
  aborted = false,
} = {}) {
  const source = fs.readFileSync(path.join(process.cwd(), "src/vite.ts"), "utf8");
  const start = source.indexOf("          const markdownResponse = viteModuleRequest");
  const end = source.indexOf("          if (markdownResponse)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const req = Object.assign(new EventEmitter(), { aborted });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed });
  const createSignal = vi.fn(createFarmNodeRequestAbortSignal);
  let signal: AbortSignal | undefined;
  const fetchPage = vi.fn(async (request: Request) => {
    signal = request.signal;
    signal.throwIfAborted();
    return new Response("<h1>Account</h1>", { headers: { "content-type": "text/html" } });
  });
  const server = {};
  const createDispatch = vi.fn((_server: unknown) => fetchPage);
  const run = new Function(
    "createMarkdownMirrorResponse",
    "createFarmNodeRequestAbortSignal",
    "createFarmDevServerDispatch",
    "server",
    "farmApp",
    "req",
    "res",
    "fullUrl",
    "requestMethod",
    "viteModuleRequest",
    `return async function () {
      const docsHeaders = new Headers({ "accept-encoding": "gzip, br" });
      const apiServerBasePath = "/api";
      ${source.slice(start, end)}
      return markdownResponse;
    };`,
  )(
    createMarkdownMirrorResponse,
    createSignal,
    createDispatch,
    server,
    {
      getConfig: () => ({ md: resolveMarkdownConfig(enabled) }),
      getRouteManager: () => ({ matchRoute: (value: string) => ({ route: value === "/account" }) }),
    },
    req,
    res,
    `https://farm.test${pathname}`,
    method,
    moduleRequest,
  ) as () => Promise<Response | null>;
  const listenerCount = () =>
    req.listenerCount("aborted") + res.listenerCount("close") + res.listenerCount("finish");
  return {
    run,
    req,
    res,
    server,
    createSignal,
    createDispatch,
    fetchPage,
    listenerCount,
    signal: () => signal,
  };
}

describe("development Markdown cancellation wiring", () => {
  it.each(["aborted", "close"])(
    "cancels the page fetch on %s and disposes listeners",
    async (event) => {
      const r = runtime();
      await r.run();
      expect(r.createSignal).toHaveBeenCalledOnce();
      expect(r.listenerCount()).toBe(3);
      if (event === "aborted") r.req.emit(event);
      else r.res.emit(event);
      expect(r.signal()?.aborted).toBe(true);
      expect(r.listenerCount()).toBe(0);
      // The page renders through this dev server's own listener, uncompressed.
      expect(r.createDispatch).toHaveBeenCalledWith(r.server);
      const pageRequest = r.fetchPage.mock.calls[0][0];
      expect(new URL(pageRequest.url).pathname).toBe("/account");
      expect(pageRequest.headers.has("accept-encoding")).toBe(false);
    },
  );

  it.each(["GET", "HEAD"])(
    "cleans up a completed %s response without aborting it",
    async (method) => {
      const r = runtime({ method });
      const response = await r.run();
      expect(await response?.text()).toBe(
        method === "GET" ? "Source: /account\n\n# Account\n" : "",
      );
      expect(r.createSignal).toHaveBeenCalledOnce();
      r.res.writableEnded = true;
      r.res.emit("finish");
      r.res.emit("close");
      expect(r.signal()?.aborted).toBe(false);
      expect(r.listenerCount()).toBe(0);
    },
  );

  it.each([{ aborted: true }, { destroyed: true }])(
    "retains an earlier disconnect (%j)",
    async (state) => {
      const r = runtime(state);
      await expect(r.run()).rejects.toMatchObject({ name: "AbortError" });
      expect(r.listenerCount()).toBe(0);
    },
  );

  it.each([
    { pathname: "/account" },
    { enabled: false },
    { pathname: "/missing.md" },
    { method: "POST" },
    { moduleRequest: true },
  ])(
    "adds no disconnect listeners or page fetch for an ineligible request (%j)",
    async (options) => {
      const r = runtime(options);
      expect(await r.run()).toBeNull();
      expect(r.createSignal).not.toHaveBeenCalled();
      expect(r.createDispatch).not.toHaveBeenCalled();
      expect(r.fetchPage).not.toHaveBeenCalled();
      expect(r.listenerCount()).toBe(0);
    },
  );
});
