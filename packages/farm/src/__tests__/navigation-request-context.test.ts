import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFarmNodeRequestAbortSignal } from "../vite";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

describe("SPA navigation request context", () => {
  it("passes the destination request to development route contexts", () => {
    const source = readSource("vite.ts");
    const start = source.indexOf("// Handle SPA page-data requests for client-side navigation");
    const end = source.indexOf("const startTime = Date.now();", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pageDataRuntime = source.slice(start, end);

    expect(pageDataRuntime.match(/request: targetRequest/g)).toHaveLength(2);
    expect(pageDataRuntime).toContain("signal: request.signal");
    expect(pageDataRuntime).not.toMatch(/resolveFarmRouteContext[\s\S]*?\{\s*request,/);
  });

  it("aborts destination work when the development client disconnects", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const signal = createFarmNodeRequestAbortSignal(request, response);

    request.emit("aborted");

    expect(signal.aborted).toBe(true);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });

  it("does not abort after a development response finishes normally", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: true });
    const signal = createFarmNodeRequestAbortSignal(request, response);

    response.emit("finish");
    response.emit("close");

    expect(signal.aborted).toBe(false);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });

  it("passes the destination request to the secondary production handler", () => {
    const source = readSource("nitro", "server-entry.ts");

    expect(source).toContain("const targetRequest = new Request(targetUrl");
    expect(source).toContain("signal: request.signal");
    expect(source).toMatch(/sr\.resolveRouteContext\(\{\s*request: targetRequest,/);
  });
});
