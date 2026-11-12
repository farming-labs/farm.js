import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSync } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { appMiddlewareMayHandlePath } from "../middleware/may-handle";
import { readMiddlewareFileConfig, readStaticMiddlewareConfig } from "../middleware/static-config";

const read = (source: string) =>
  readStaticMiddlewareConfig(parseSync("middleware.ts", source).program as never);

describe("a middleware file's literal config", () => {
  it("reads string, regular expression and array matchers, and excludes", () => {
    expect(read(`export const config = { matcher: "/api/:path*" };`)).toEqual({
      matcher: ["/api/:path*"],
    });
    expect(
      read(
        `export const config = { matcher: ["/a", /^\\/b/i], exclude: ["/a/x"], cache: "public" } as const;`,
      ),
    ).toEqual({ matcher: ["/a", /^\/b/i], exclude: ["/a/x"] });
    expect(read(`export default function middleware() {}`)).toBeNull();
  });

  it("reads a literal runtime, and leaves any other value on the server", () => {
    expect(read(`export const config = { runtime: "edge" };`)).toEqual({ runtime: "edge" });
    expect(read(`export const config = { matcher: "/docs/:path*", runtime: "nodejs" };`)).toEqual({
      matcher: ["/docs/:path*"],
      runtime: "nodejs",
    });
    // Not a literal "edge": the file runs in the server, and its matcher still counts.
    expect(read(`const r = "edge"; export const config = { matcher: "/a", runtime: r };`)).toEqual({
      matcher: ["/a"],
    });
    expect(read(`export const config = { runtime: "experimental-edge" };`)).toEqual({});
  });

  it("reads anything it cannot prove as unknown", () => {
    expect(read(`const m = "/api"; export const config = { matcher: m };`)).toBe("unknown");
    expect(read(`export const config = { matcher: [(ctx) => true] };`)).toBe("unknown");
    expect(read(`const config = { matcher: "/a" }; export { config };`)).toBe("unknown");
    expect(read(`export let config = { matcher: "/a" };`)).toBe("unknown");
    expect(read(`export const config = makeConfig();`)).toBe("unknown");
  });
});

describe("prerendering under app middleware", () => {
  const root = mkdtemp(path.join(tmpdir(), "farm-mw-config-"));
  afterAll(async () => rm(await root, { recursive: true, force: true }));

  it("keeps a page server-handled only when a middleware file may run for it", async () => {
    const file = path.join(await root, "middleware.ts");
    await writeFile(
      file,
      `export default () => {};\nexport const config = { matcher: "/api/:path*" };\n`,
    );
    const scoped = [{ path: "/", filePath: file, config: await readMiddlewareFileConfig(file) }];
    expect(appMiddlewareMayHandlePath(scoped, "/static/a")).toBe(false);
    expect(appMiddlewareMayHandlePath(scoped, "/api/users")).toBe(true);
    // Without a config read (or a computed one), the file covers its folder, as before.
    expect(appMiddlewareMayHandlePath([{ path: "/" }], "/static/a")).toBe(true);
    expect(appMiddlewareMayHandlePath([{ path: "/", config: "unknown" }], "/static/a")).toBe(true);
    // A nested file never runs outside its folder.
    expect(appMiddlewareMayHandlePath([{ path: "/admin", config: null }], "/static/a")).toBe(false);
  });
});
