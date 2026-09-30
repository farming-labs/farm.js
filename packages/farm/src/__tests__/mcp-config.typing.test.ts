// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("types endpoint selections and readonly authorization context through the public entry", () => {
  const filename = path.resolve("mcp-config.type-test.ts").replace(/\\/g, "/");
  const source = `
import { defineConfig, type FarmMCPConfig, type FarmMCPTool } from "@farm.js/core";
import { createEndpoint, createRouteFactory } from "@farm.js/core/api";
import { z } from "zod";
const get = createEndpoint("/api/projects", { method: "GET", query: z.object({ status: z.string() }) }, ({ query }) => ({ status: query.status }));
const post = createEndpoint("/api/projects", { method: "POST", body: z.object({ name: z.string() }) }, ({ body }) => body);
const route = createRouteFactory().get("/api/health", { handler: () => ({ ok: true }) });
defineConfig({ mcp: {
  tools: [get, { endpoint: post, name: "create_project" }, route],
  authorize: ({ request, tools, tool, server }) => {
    const identity: string = server.name;
    const path: FarmMCPConfig["path"] = server.path;
    const called: string | undefined = tool;
    const first: FarmMCPTool | undefined = tools[0];
    // @ts-expect-error catalog is immutable
    tools.push(first);
    // @ts-expect-error tool identities are immutable
    tools[0].name = "other";
    // @ts-expect-error transport identity is immutable
    server.path = "/api/other";
    return { subject: "agent", tools: tools.filter(item => item.name === "get_projects").map(item => item.name) };
  },
} });
const wrong: FarmMCPConfig = {
  // @ts-expect-error a string map is not an endpoint selection
  tools: { "GET /api/projects": { name: "projects" } },
};
const wrongReference: FarmMCPConfig = {
  // @ts-expect-error arbitrary handlers are not typed endpoints
  tools: [() => null],
};
const wrongPolicy: FarmMCPConfig = {
  // @ts-expect-error authorization returns tool names, not descriptors
  authorize: ({ tools }) => ({ subject: "agent", tools }),
};
// @ts-expect-error endpoint input inference is preserved after being selected
post({ body: { name: 123 } });
`;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === filename
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({ rootNames: [filename], options, host });
  const diagnostics = ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
  expect(diagnostics).toBe("");
}, 30_000);
