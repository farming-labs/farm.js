import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// public/openapi.json is written by hand: it describes only the APIs farmjs.dev offers the public,
// never the routes the site runs itself (telemetry, waitlist signups).
const spec = JSON.parse(
  readFileSync(new URL("../public/openapi.json", import.meta.url), "utf8"),
) as {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
};

// Served by the docs engine (docs.config.ts), not by a route file in src/app.
const DOCS_ENGINE_PATHS = new Set(["/api/docs", "/api/docs/mcp"]);

describe("public/openapi.json", () => {
  it("is an OpenAPI 3.1 document for farmjs.dev", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.servers).toEqual([{ url: "https://farmjs.dev" }]);
  });

  it("describes no maintainer-only routes", () => {
    for (const path of Object.keys(spec.paths)) {
      expect(path).not.toMatch(/^\/api\/(?:telemetry|waitlist)(?:\/|$)/);
    }
  });

  it("describes only routes the site serves, with the methods they export", () => {
    for (const [path, operations] of Object.entries(spec.paths)) {
      if (DOCS_ENGINE_PATHS.has(path)) continue;
      const file = new URL(`./app${path}/route.ts`, import.meta.url);
      expect(existsSync(file), `${path} has a route file`).toBe(true);
      const source = readFileSync(file, "utf8");
      for (const method of Object.keys(operations)) {
        expect(source, `${path} exports ${method.toUpperCase()}`).toMatch(
          new RegExp(`export (?:async function|const) ${method.toUpperCase()}\\b`),
        );
      }
    }
  });
});
