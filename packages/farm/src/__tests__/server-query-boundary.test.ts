import { describe, expect, it } from "vitest";
import { findClientServerFnViolation, formatServerFnBoundaryError } from "../server-query-boundary";

const QUERY_MODULE = `
import { createServerQuery } from "@farm.js/core";
import { assertSafeTarget } from "./dns-guard.server";

export const scanQuery = createServerQuery({
  key: () => ["scan"],
  handler: async ({ input }) => assertSafeTarget(input.host),
});
`;

describe("findClientServerFnViolation", () => {
  it("flags createServerQuery definitions compiled for the client", () => {
    expect(findClientServerFnViolation(QUERY_MODULE, "/app/src/lib/scan-query.ts")).toEqual({
      factory: "createServerQuery",
    });
  });

  it("flags createServerFn definitions", () => {
    const code = `
import { createServerFn } from "@farm.js/core/server";
export const fn = createServerFn({ handler: async () => 1 });
`;
    expect(findClientServerFnViolation(code, "/app/src/fn.ts")).toEqual({
      factory: "createServerFn",
    });
  });

  it("ignores modules that only import other core APIs", () => {
    const code = `
import { useServerQuery } from "@farm.js/core/server-query/client";
import { scanQuery } from "./scan-query";
export function Panel() {
  return useServerQuery(scanQuery, { host: "example.com" });
}
`;
    expect(findClientServerFnViolation(code, "/app/src/panel.tsx")).toBeNull();
  });

  it("ignores type-only imports", () => {
    const code = `
import type { createServerQuery } from "@farm.js/core";
export type Q = typeof createServerQuery;
`;
    expect(findClientServerFnViolation(code, "/app/src/types.ts")).toBeNull();
  });

  it("ignores imports without a call site", () => {
    const code = `
import { createServerQuery } from "@farm.js/core";
export { createServerQuery };
`;
    expect(findClientServerFnViolation(code, "/app/src/reexport.ts")).toBeNull();
  });

  it("ignores similarly named local functions", () => {
    const code = `
import { defineConfig } from "@farm.js/core";
const myCreateServerQuery = (options) => options;
export const q = myCreateServerQuery({});
`;
    expect(findClientServerFnViolation(code, "/app/src/local.ts")).toBeNull();
  });

  it("ignores virtual modules and dependencies", () => {
    expect(findClientServerFnViolation(QUERY_MODULE, "\0virtual:farm-entry")).toBeNull();
    expect(findClientServerFnViolation(QUERY_MODULE, "virtual:farm-entry")).toBeNull();
    expect(
      findClientServerFnViolation(QUERY_MODULE, "/app/node_modules/some-lib/dist/index.js"),
    ).toBeNull();
  });
});

describe("formatServerFnBoundaryError", () => {
  it("names the factory, the module, and both remediations", () => {
    const message = formatServerFnBoundaryError(
      { factory: "createServerQuery" },
      "/app/src/lib/scan-query.ts",
    );
    expect(message).toContain("createServerQuery");
    expect(message).toContain("/app/src/lib/scan-query.ts");
    expect(message).toContain("experimental.serverActions");
    expect(message).toContain("@farm.js/plugin/rsc");
    expect(message).toContain("createAPIClient");
  });
});
