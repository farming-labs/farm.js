// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseAst } from "vite";
import {
  analyzeClientBoundary,
  createClientBoundaryDiagnostic,
  shouldInspectClientBoundary,
  type ClientBoundaryFindingKind,
} from "../client-boundary-env";
import { formatFarmDiagnostic } from "../diagnostics";

const NO_PUBLIC = new Set<string>();

function analyze(code: string, publicKeys: ReadonlySet<string> = NO_PUBLIC) {
  const findings = analyzeClientBoundary(parseAst(code), publicKeys);
  const names = (kind: ClientBoundaryFindingKind) =>
    findings.filter((finding) => finding.kind === kind).map((finding) => finding.name);
  return {
    findings,
    envKeys: names("server-env"),
    publicEnvKeys: names("public-env"),
    builtinImports: names("builtin"),
  };
}

describe("shouldInspectClientBoundary", () => {
  it("inspects app modules that mention process.env or node:", () => {
    expect(
      shouldInspectClientBoundary("/app/src/layout.tsx", "const k = process.env.SECRET;"),
    ).toBe(true);
    expect(shouldInspectClientBoundary("/app/src/db.ts", 'import fs from "node:fs";')).toBe(true);
  });

  it("inspects app modules that import a builtin by its bare name", () => {
    for (const code of [
      'import fs from "fs";',
      "import { join } from 'path/posix';",
      'const os = require("os");',
      'export * from "url";',
      'import "crypto";',
    ]) {
      expect(shouldInspectClientBoundary("/app/src/db.ts", code), code).toBe(true);
    }
  });

  it("skips modules without a marker, including packages named like a builtin's prefix", () => {
    expect(shouldInspectClientBoundary("/app/src/a.ts", 'import x from "fs-extra";')).toBe(false);
    expect(shouldInspectClientBoundary("/app/src/a.ts", 'import x from "./path";')).toBe(false);
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

  it("flags keys destructured from process.env at module scope", () => {
    const code = `
const { DATABASE_URL, "API_KEY": key, PUBLIC_URL = "", NODE_ENV, ...rest } = process.env;
export function later() {
  const { INSIDE } = process.env;
}
`;
    const findings = analyze(code, new Set(["PUBLIC_URL"]));
    expect(findings.envKeys).toEqual(["DATABASE_URL", "API_KEY"]);
    expect(findings.publicEnvKeys).toEqual(["PUBLIC_URL"]);
  });

  it("reports each finding at its first occurrence, in source order", () => {
    const code =
      'const a = process.env.SECRET;\nimport fs from "node:fs";\nconst b = process.env.SECRET;';
    expect(analyze(code).findings).toEqual([
      { kind: "server-env", name: "SECRET", start: code.indexOf("process.env.SECRET") },
      { kind: "builtin", name: "node:fs", start: code.indexOf("import fs") },
    ]);
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

  it("reports bare builtin specifiers for the resolver to confirm", () => {
    const code = `
import fs from "fs";
import { posix } from "path/posix";
const events = require("events");
import extra from "fs-extra";
`;
    expect(analyze(code).builtinImports).toEqual(["fs", "path/posix", "events"]);
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

describe("createClientBoundaryDiagnostic", () => {
  it("formats each finding with its code, position, fix, and docs link", () => {
    const text = formatFarmDiagnostic(
      createClientBoundaryDiagnostic(
        "/app/src/layout.tsx",
        { kind: "server-env", name: "DATABASE_URL", start: 0 },
        { line: 10, column: 13 },
      ),
      "/app",
    );
    expect(text).toBe(
      [
        "src/layout.tsx:10:13 - warning CLIENT_SERVER_ENV: process.env.DATABASE_URL is read at module scope in a module compiled for the browser, where it is undefined.",
        "  fix: Read it on the server (a server function, API route, or server component), or declare it in env.public in farm.config.ts and read it through publicEnv.",
        "  docs: https://farmjs.dev/docs/environment-functions#boundary-diagnostics",
      ].join("\n"),
    );
  });

  it("points public-key reads at publicEnv", () => {
    const diagnostic = createClientBoundaryDiagnostic("/app/src/config.ts", {
      kind: "public-env",
      name: "PUBLIC_API_URL",
      start: 0,
    });
    expect(diagnostic).toMatchObject({ code: "CLIENT_PROCESS_ENV_PUBLIC", severity: "warning" });
    expect(diagnostic.fix).toContain('publicEnv from "@farm.js/core/env"');
  });

  it("names the builtin and keeps the absolute path for a file outside the root", () => {
    const text = formatFarmDiagnostic(
      createClientBoundaryDiagnostic("/shared/db.ts", { kind: "builtin", name: "fs", start: 0 }),
      "/app",
    );
    expect(text.split("\n")[0]).toBe(
      '/shared/db.ts - warning CLIENT_NODE_BUILTIN: "fs" is imported into a module compiled for the browser, which gets a stub whose exports without a Web API equivalent are undefined.',
    );
  });
});
