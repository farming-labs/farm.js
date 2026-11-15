import { describe, expect, it, vi } from "vitest";
import { ClientRouteManifest } from "../api/client-routes";

describe("client route candidates", () => {
  it("does not scan unrelated routes on a static call or parameter binding", () => {
    const manifest = new ClientRouteManifest(
      Array.from({ length: 1_000 }, (_, i) => ({
        path: `/api/resource-${i}/[id]`,
        methods: ["GET"],
      })).concat([{ path: "/api/health", methods: ["GET"] }]),
    );
    const routes = (manifest as any).routes as Map<string, unknown>;
    const values = vi.spyOn(routes, "values");
    const keys = vi.spyOn(routes, "keys");
    expect(manifest.resolve("/api/health", "GET", {})).toBe("/api/health");
    expect(manifest.bind("/api/resource-0", { id: "one" }).segment).toBe("[id]");
    expect(values).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
  });

  it("preserves exact/optional ambiguity, methods, and duplicate replacement", () => {
    const manifest = new ClientRouteManifest([
      { path: "/api/docs", methods: ["GET"] },
      { path: "/api/docs/[[...slug]]", methods: ["GET"] },
      { path: "/api/item/", methods: ["POST"] },
      { path: "/api/item", methods: ["GET"] },
    ]);
    expect(manifest.resolve("/api/docs", "GET", {})).toBe("/api/docs");
    expect(() => manifest.resolve("/api/docs", "GET", {}, { params: {} })).toThrow("ambiguous");
    expect(manifest.resolve("/api/item/", "HEAD", {})).toBe("/api/item");
    expect(() => manifest.resolve("/api/item", "POST", {})).toThrow("not registered");
  });

  it("keeps nested binding, input snapshots, encoding and shadow detection", () => {
    const input = [
      { path: "/api/teams/[team]/members/[id]", methods: ["GET"] },
      { path: "/api/teams/special/members/fixed", methods: ["GET"] },
    ];
    const manifest = new ClientRouteManifest(input);
    input[0].path = "/changed";
    input[0].methods.length = 0;
    const team = manifest.bind("/api/teams", { team: "café" });
    const id = manifest.bind("/api/teams/[team]/members", { id: "a/b" });
    expect(
      manifest.resolve("/api/teams/[team]/members/[id]", "GET", { ...team.params, ...id.params }),
    ).toBe("/api/teams/caf%C3%A9/members/a%2Fb");
    expect(() =>
      manifest.resolve("/api/teams/[team]/members/[id]", "GET", { team: "special", id: "fixed" }),
    ).toThrow("shadowed");
    expect(() => manifest.bind("/api/teams", { wrong: "x" })).toThrow("Cannot bind");
  });
});
