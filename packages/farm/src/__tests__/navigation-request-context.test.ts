import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

describe("SPA navigation request context", () => {
  it("passes the destination request to development route contexts", () => {
    const source = readSource("vite.ts");
    const start = source.indexOf("// Handle SPA page-data requests for client-side navigation");
    const end = source.indexOf("// Handle API routes", start);
    const pageDataRuntime = source.slice(start, end);

    expect(pageDataRuntime.match(/request: targetRequest/g)).toHaveLength(2);
    expect(pageDataRuntime).not.toMatch(/resolveFarmRouteContext[\s\S]*?\{\s*request,/);
  });

  it("passes the destination request to the secondary production handler", () => {
    const source = readSource("nitro", "server-entry.ts");

    expect(source).toContain("const targetRequest = new Request(targetUrl");
    expect(source).toMatch(/sr\.resolveRouteContext\(\{\s*request: targetRequest,/);
  });
});
