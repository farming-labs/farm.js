import { describe, expect, it } from "vitest";
import {
  compileMiddlewareConfig,
  matchesCompiledMiddlewareConfig,
  matchesMiddlewareConfig,
} from "../middleware/matcher";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type { MiddlewareContext } from "../middleware/types";

function context(pathname: string): MiddlewareContext {
  return { pathname } as MiddlewareContext;
}

describe("compiled middleware config", () => {
  it("observes edits to matcher and exclusion lists after warming", () => {
    const config = { matcher: ["/first"], exclude: [] as string[] };
    const match = (pathname: string) =>
      matchesMiddlewareConfig(pathname, config, context(pathname)).matched;
    expect(match("/first")).toBe(true);
    config.matcher[0] = "/second";
    expect(match("/first")).toBe(false);
    expect(match("/second")).toBe(true);
    config.exclude.push("/second");
    expect(match("/second")).toBe(false);
    config.exclude.length = 0;
    config.matcher = ["/third"];
    expect(match("/third")).toBe(true);
  });

  it("keeps the production runner's warmed exclusions live", async () => {
    const exclude: string[] = [];
    const run = createProductionMiddlewareRunner({
      config: {
        matcher: ["/secure"],
        exclude,
        handler: (ctx) => {
          ctx.headers.set("x-matched", "yes");
        },
      },
    });
    const request = () => run(new Request("https://example.test/secure"));
    expect((await request()).headers.get("x-matched")).toBe("yes");
    exclude.push("/secure");
    expect((await request()).headers.get("x-matched")).toBeNull();
  });

  it("reuses compiled path patterns across requests", () => {
    const compiled = compileMiddlewareConfig({
      matcher: Array.from({ length: 100 }, (_, index) => `/resource-${index}/:id`),
    });
    const patterns = compiled.matcher;

    expect(
      matchesCompiledMiddlewareConfig(
        "/resource-99/first",
        compiled,
        context("/resource-99/first"),
      ),
    ).toEqual({ matched: true, params: { id: "first" } });
    expect(
      matchesCompiledMiddlewareConfig(
        "/resource-99/second",
        compiled,
        context("/resource-99/second"),
      ),
    ).toEqual({ matched: true, params: { id: "second" } });
    expect(compiled.matcher).toBe(patterns);
  });

  it("preserves exclusions, function ordering, and one-pass decoding", () => {
    const compiled = compileMiddlewareConfig({
      exclude: ["/dashboard/private/:path*"],
      matcher: [() => false, "/dashboard/[section]"],
    });

    expect(
      matchesCompiledMiddlewareConfig(
        "/%64ashboard/reports",
        compiled,
        context("/%64ashboard/reports"),
      ),
    ).toEqual({ matched: true, params: { section: "reports" } });
    expect(
      matchesCompiledMiddlewareConfig(
        "/dashboard/private/settings",
        compiled,
        context("/dashboard/private/settings"),
      ),
    ).toEqual({ matched: false });
  });

  it("resets stateful regular expressions for every request", () => {
    const matcher = /^\/projects\/(?<project>[^/]+)$/g;
    const compiled = compileMiddlewareConfig({ matcher });

    expect(
      matchesCompiledMiddlewareConfig("/projects/alpha", compiled, context("/projects/alpha")),
    ).toEqual({ matched: true, params: { project: "alpha" } });
    expect(
      matchesCompiledMiddlewareConfig("/projects/beta", compiled, context("/projects/beta")),
    ).toEqual({ matched: true, params: { project: "beta" } });
  });
});
