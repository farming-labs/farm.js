import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APITypeGenerator } from "../type-generator";

describe("APITypeGenerator", () => {
  it("quotes invalid TypeScript property keys in generated router types", () => {
    const generator = new APITypeGenerator("/tmp/app");

    const content = generator.generateAPIRouter([
      {
        path: "/api/storage-demo",
        methods: ["GET", "POST"],
        filePath: "/tmp/app/api/storage-demo/route.ts",
        relativePath: "api/storage-demo/route.ts",
      },
    ]);

    expect(content).toContain('"storage-demo": {');
    expect(content).toContain("get: typeof GET_storagedemo;");
    expect(content).toContain("post: typeof POST_storagedemo;");
  });

  it("creates the output directory before writing generated API types", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-api-types-"));
    const appDir = path.join(root, "src", "app");
    const routeDir = path.join(appDir, "api", "docs");
    mkdirSync(routeDir, { recursive: true });
    const outputPath = path.join(root, "src", "lib", "api.generated.ts");

    const routePath = path.join(routeDir, "route.ts");
    writeFileSync(routePath, "export const GET = async () => new Response('ok');\n");

    const generator = new APITypeGenerator(appDir);
    generator.generateAPIIndex(outputPath);

    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf8")).toContain("Auto-generated API router types");
  });

  it("detects function-style handlers and JavaScript route files", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-api-types-"));
    const appDir = path.join(root, "src", "app");
    const statusRouteDir = path.join(appDir, "api", "status");
    const profileRouteDir = path.join(appDir, "api", "profile");
    mkdirSync(statusRouteDir, { recursive: true });
    mkdirSync(profileRouteDir, { recursive: true });

    writeFileSync(
      path.join(statusRouteDir, "route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n",
    );
    writeFileSync(
      path.join(profileRouteDir, "route.js"),
      "export function POST() { return Response.json({ ok: true }); }\n",
    );

    const generator = new APITypeGenerator(appDir);
    const content = generator.generateAPIRouter(generator.scanAPIRoutes());

    expect(content).toContain("import type { GET as GET_status }");
    expect(content).toContain("import type { POST as POST_profile }");
    expect(content).toContain("status: {");
    expect(content).toContain("profile: {");
  });
});
