// @vitest-environment node
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { MiddlewareManager, type DiscoveredMiddleware } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import { matchesMiddlewareRoute } from "../middleware/matcher";
import { matchRoutePath as previousMatch } from "../__benchmarks__/controls/file-middleware";

function request(pathname: string): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.url = pathname;
  req.headers.host = "example.test";
  return req;
}

describe("file middleware pattern reuse", () => {
  it("preserves matching and one-pass decoding across supported path patterns", () => {
    const patterns = [
      "/",
      "/admin",
      "/projects/[id]",
      "/projects/:id",
      "/files/[...path]",
      "/files/:path*",
      "/files/:path+",
      "/files/*",
      "/files/**",
      "/admin/(.*)",
      "/(.*)",
      "*",
      "/files/:__farmRest",
      "/v1.0/[id]",
    ];
    const paths = [
      "/",
      "/missing",
      "/admin",
      "/admin/nested",
      "/admin-other",
      "/%61dmin",
      "/projects/first",
      "/projects/second/nested",
      "/projects/%2541BC/deep",
      "/projects/a%2Fb/deep",
      "/projects/%ZZ",
      "/files",
      "/files/",
      "/files/a/b",
      "/v1.0/test",
      "//projects//first/",
    ];
    for (const path of patterns) {
      const entry = { path };
      for (const pathname of paths) {
        expect(matchesMiddlewareRoute(pathname, entry), `${path} against ${pathname}`).toEqual(
          previousMatch(pathname, path),
        );
        expect(matchesMiddlewareRoute(pathname, entry)).toEqual(previousMatch(pathname, path));
      }
    }
  });

  it("observes live development entry path edits and replacement entries", async () => {
    const seen: unknown[] = [];
    const entry: DiscoveredMiddleware = {
      path: "/first/[id]",
      filePath: "middleware.ts",
      source: "file",
      handlers: [
        (ctx) => {
          seen.push({ ...ctx.params });
        },
      ],
    };
    const manager = new MiddlewareManager("/unused");
    (manager as any).middleware = [entry];
    const run = async (path: string) => {
      const req = request(path);
      await manager.execute(req, new ServerResponse(req));
    };
    await run("/first/one");
    manager.getMiddlewares()[0].path = "/second/[id]";
    await run("/first/ignored");
    await run("/second/two/nested");
    entry.path = "/";
    await run("/anything");
    entry.path = "/third/[id]";
    await run("/anything");
    await run("/third/three");
    (manager as any).middleware = [{ ...entry, path: "/replacement/[id]" }];
    await run("/third/ignored");
    await run("/replacement/four");
    expect(seen).toEqual([{ id: "one" }, { id: "two" }, {}, { id: "three" }, { id: "four" }]);
  });

  for (const mode of ["development", "production"] as const) {
    it(`does not recompile unchanged file paths in ${mode}`, async () => {
      const entries: DiscoveredMiddleware[] = Array.from({ length: 100 }, (_, index) => ({
        path: `/resource-${index}/[id]`,
        filePath: `resource-${index}/[id]/middleware.ts`,
        handlers: [
          async (_ctx, next) => {
            await next();
          },
        ],
        source: "file",
      }));
      const manager = new MiddlewareManager("/unused");
      (manager as any).middleware = entries;
      const production = createProductionMiddlewareRunner({
        modules: entries.map((entry) => ({
          path: entry.path,
          module: { default: entry.handlers[0] },
        })),
      });
      const run = async () => {
        if (mode === "production") return production(new Request("https://example.test/missing"));
        const req = request("/missing");
        return manager.execute(req, new ServerResponse(req));
      };
      await run();
      const nativeRegExp = globalThis.RegExp;
      let compilations = 0;
      vi.stubGlobal(
        "RegExp",
        new Proxy(nativeRegExp, {
          construct(target, args) {
            if (String(args[0]).includes("resource-")) compilations++;
            return Reflect.construct(target, args);
          },
        }),
      );
      try {
        await run();
        expect(compilations).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  }
});
