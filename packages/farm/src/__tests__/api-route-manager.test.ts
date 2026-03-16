import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { APIRouteManager } from "../api/route-manager";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("APIRouteManager", () => {
  it("parses DELETE request bodies", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "storage-demo");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          DELETE: async (ctx: { body: unknown }) => ({
            method: "DELETE",
            body: ctx.body ?? null,
          }),
          POST: async (ctx: { body: unknown }) => ({
            method: "POST",
            body: ctx.body ?? null,
          }),
        };
      },
    } as any);
    await manager.discoverRoutes();
    const handler = manager.getHandler();

    expect(handler).toBeTypeOf("function");

    const deleteResponse = await handler!(
      new Request("http://example.com/api/storage-demo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "sqlite", clear: true }),
      }),
    );

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      method: "DELETE",
      body: { backend: "sqlite", clear: true },
    });

    const postResponse = await handler!(
      new Request("http://example.com/api/storage-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "local", value: "hello" }),
      }),
    );

    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toEqual({
      method: "POST",
      body: { backend: "local", value: "hello" },
    });
  });
});
