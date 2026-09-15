// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseAst } from "vite";
import {
  analyzeClientBoundary,
  formatClientBoundaryWarning,
  shouldInspectClientBoundary,
} from "../client-boundary-env";

const NO_PUBLIC = new Set<string>();

function analyze(code: string, publicKeys: ReadonlySet<string> = NO_PUBLIC) {
  return analyzeClientBoundary(parseAst(code), publicKeys);
}

describe("shouldInspectClientBoundary", () => {
  it("inspects app modules that mention process.env or node:", () => {
    expect(
      shouldInspectClientBoundary("/app/src/layout.tsx", "const k = process.env.SECRET;"),
    ).toBe(true);
    expect(shouldInspectClientBoundary("/app/src/db.ts", 'import fs from "node:fs";')).toBe(true);
  });

  it("skips modules without either marker", () => {
    expect(shouldInspectClientBoundary("/app/src/button.tsx", "export const n = 1;")).toBe(false);
  });

  it("skips virtual modules and dependencies", () => {
    const code = "const k = process.env.SECRET;";
    expect(shouldInspectClientBoundary("\0farm:routes", code)).toBe(false);
    expect(shouldInspectClientBoundary("virtual:farm/env", code)).toBe(false);
    expect(shouldInspectClientBoundary("/app/node_modules/dep/index.js", code)).toBe(false);
  });
});

describe("analyzeClientBoundary: process.env reads", () => {
  it("flags a module-scope read of a non-public key", () => {
    expect(analyze("const url = process.env.DATABASE_URL;").envKeys).toEqual(["DATABASE_URL"]);
  });

  it("flags computed string reads", () => {
    expect(analyze('const url = process.env["DATABASE_URL"];').envKeys).toEqual(["DATABASE_URL"]);
  });

  it("skips NODE_ENV entirely", () => {
    const code = "const mode = process.env.NODE_ENV;";
    const findings = analyze(code);
    expect(findings.envKeys).toEqual([]);
    expect(findings.publicEnvKeys).toEqual([]);
  });

  it("reports declared-public keys separately from server-only keys", () => {
    const code = "const a = process.env.SECRET; const b = process.env.PUBLIC_API_URL;";
    const findings = analyze(code, new Set(["PUBLIC_API_URL"]));
    expect(findings.envKeys).toEqual(["SECRET"]);
    expect(findings.publicEnvKeys).toEqual(["PUBLIC_API_URL"]);
  });

  it("skips reads inside function bodies", () => {
    const code = `
export function getUrl() {
  return process.env.DATABASE_URL;
}
export const arrow = () => process.env.API_KEY;
`;
    expect(analyze(code).envKeys).toEqual([]);
  });

  it("flags reads in module-scope call arguments and exported initializers", () => {
    const code = `
import { createClient } from "some-sdk";
export const client = createClient(process.env.SECRET_KEY);
`;
    expect(analyze(code).envKeys).toEqual(["SECRET_KEY"]);
  });

  it("dedupes repeated reads of the same key", () => {
    const code = "const a = process.env.SECRET; const b = process.env.SECRET;";
    expect(analyze(code).envKeys).toEqual(["SECRET"]);
  });

  it("ignores other member chains and destructuring of unrelated objects", () => {
    const code = `
const env = config.env.SECRET;
const { SECRET } = settings;
`;
    expect(analyze(code).envKeys).toEqual([]);
  });
});

describe("analyzeClientBoundary: node builtin imports", () => {
  it("finds static import, module-scope dynamic import, require, and re-export forms", () => {
    const code = `
import fs from "node:fs";
import { join } from 'node:path';
const crypto = await import("node:crypto");
const os = require("node:os");
export { readFile } from "node:fs/promises";
export * from "node:url";
`;
    expect(analyze(code).builtinImports.sort()).toEqual([
      "node:crypto",
      "node:fs",
      "node:fs/promises",
      "node:os",
      "node:path",
      "node:url",
    ]);
  });

  it("does not flag the server-gated lazy-import escape hatch inside functions", () => {
    const code = `
export async function readOnServer() {
  const fs = await import("node:fs/promises");
  return fs.readFile("data.txt", "utf8");
}
`;
    expect(analyze(code).builtinImports).toEqual([]);
  });

  it("ignores node: inside ordinary strings and other specifiers", () => {
    const code = `
const label = "node:fs";
import { api } from "./api";
import pkg from "some-package";
`;
    expect(analyze(code).builtinImports).toEqual([]);
  });

  it("dedupes repeated imports", () => {
    const code = 'import a from "node:fs"; const b = require("node:fs");';
    expect(analyze(code).builtinImports).toEqual(["node:fs"]);
  });
});

describe("formatClientBoundaryWarning", () => {
  it("names the module, the keys, and the builtins", () => {
    const message = formatClientBoundaryWarning("/app/src/layout.tsx", {
      envKeys: ["DATABASE_URL"],
      publicEnvKeys: [],
      builtinImports: ["node:fs"],
    });
    expect(message).toContain("/app/src/layout.tsx");
    expect(message).toContain("process.env.DATABASE_URL");
    expect(message).toContain("undefined in the browser");
    expect(message).toContain("node:fs");
    expect(message).toContain("stubbed with an empty object");
  });

  it("points public-key reads at publicEnv", () => {
    const message = formatClientBoundaryWarning("/app/src/config.ts", {
      envKeys: [],
      publicEnvKeys: ["PUBLIC_API_URL"],
      builtinImports: [],
    });
    expect(message).toContain("process.env.PUBLIC_API_URL");
    expect(message).toContain('publicEnv from "@farm.js/core/env"');
    expect(message).not.toContain("stubbed");
  });

  it("omits the section that does not apply", () => {
    const envOnly = formatClientBoundaryWarning("/app/a.ts", {
      envKeys: ["SECRET"],
      publicEnvKeys: [],
      builtinImports: [],
    });
    expect(envOnly).not.toContain("stubbed");
    const builtinOnly = formatClientBoundaryWarning("/app/b.ts", {
      envKeys: [],
      publicEnvKeys: [],
      builtinImports: ["node:path"],
    });
    expect(builtinOnly).not.toContain("process.env");
  });
});
