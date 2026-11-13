import { describe, expect, it } from "vitest";
import { formatFarmDiagnostic } from "../diagnostics";
import {
  createServerFnBoundaryDiagnostic,
  findClientServerFnViolation,
} from "../server-query-boundary";

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
      start: QUERY_MODULE.indexOf("createServerQuery({"),
    });
  });

  it("flags createServerFn definitions", () => {
    const code = `
import { createServerFn } from "@farm.js/core/server";
export const fn = createServerFn({ handler: async () => 1 });
`;
    expect(findClientServerFnViolation(code, "/app/src/fn.ts")).toEqual({
      factory: "createServerFn",
      start: code.indexOf("createServerFn({"),
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

  it("ignores markdown pages whose fenced examples show server functions", () => {
    const page = `---
title: "Server Queries"
---

# Server Queries

\`\`\`ts
import { createServerQuery } from "@farm.js/core";

export const scanQuery = createServerQuery({
  key: () => ["scan"],
  handler: async () => 1,
});
\`\`\`
`;
    expect(
      findClientServerFnViolation(page, "/app/src/app/docs/server-queries/page.md"),
    ).toBeNull();
    expect(
      findClientServerFnViolation(page, "/app/src/app/docs/server-queries/page.md?import"),
    ).toBeNull();
    expect(findClientServerFnViolation(page, "/app/src/content/guide.mdx")).toBeNull();
  });

  it("ignores virtual modules and dependencies", () => {
    expect(findClientServerFnViolation(QUERY_MODULE, "\0virtual:farm-entry")).toBeNull();
    expect(findClientServerFnViolation(QUERY_MODULE, "virtual:farm-entry")).toBeNull();
    expect(
      findClientServerFnViolation(QUERY_MODULE, "/app/node_modules/some-lib/dist/index.js"),
    ).toBeNull();
  });
});

describe("createServerFnBoundaryDiagnostic", () => {
  it("names the code, the factory, the module, its position, and both remediations", () => {
    const message = formatFarmDiagnostic(
      createServerFnBoundaryDiagnostic(
        { factory: "createServerQuery", start: 0 },
        "/app/src/lib/scan-query.ts",
        { line: 8, column: 26 },
      ),
      "/app",
    );
    expect(message).toContain(
      "src/lib/scan-query.ts:8:26 - error CLIENT_SERVER_FUNCTION: createServerQuery handlers run only on the server",
    );
    expect(message).toContain("experimental.serverActions");
    expect(message).toContain("@farm.js/plugin/rsc");
    expect(message).toContain("createAPIClient");
  });
});
