import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("preserves schema inference and mixed config types through the published MCP entry", () => {
  const filename = path.resolve("standalone-tool.type-test.ts").replace(/\\/g, "/");
  const source = `
import { defineTool } from "./dist/index";
import { defineConfig, type FarmMCPExecuteContext } from "@farm.js/core";
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
const native = defineTool({
  name: "count",
  inputSchema: z.object({ count: z.string().transform(Number), limit: z.number().default(5) }),
  execute: ({ count, limit }, { authorization, request, signal }) => {
    const n: number = count + limit;
    const subject: string = authorization.subject;
    const token: string | null = request.headers.get("authorization");
    const aborted: boolean = signal.aborted;
    // @ts-expect-error transformed input is not a string or any
    const wrong: string = count;
    // @ts-expect-error context cannot replace the authorization principal
    authorization.subject = "other";
    return { value: n };
  },
});
declare const context: FarmMCPExecuteContext;
const result: { value: number } | Promise<{ value: number }> = native.execute({ count: 4, limit: 5 }, context);
// @ts-expect-error execute receives validated schema output, not wire input
native.execute({ count: "4", limit: 5 }, context);
const validated = defineTool({
  name: "validated_count",
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ count: z.string().transform(Number).pipe(z.number()) }),
  execute: ({ value }) => ({ count: String(value) }),
});
const schemaInput: { count: string } | Promise<{ count: string }> = validated.execute({ value: 4 }, context);
const asyncValidated = defineTool({
  name: "async_count",
  inputSchema: z.object({}),
  outputSchema: z.object({ count: z.number() }),
  execute: async () => ({ count: 1 }),
});
defineTool({
  name: "wrong_output", inputSchema: z.object({}), outputSchema: z.object({ count: z.number() }),
  // @ts-expect-error the result must match the output schema's input, not any
  execute: () => ({ count: "wrong" }),
});
defineTool({
  name: "wrong_async_output", inputSchema: z.object({}), outputSchema: z.object({ count: z.number() }),
  // @ts-expect-error asynchronous results are checked too
  execute: async () => ({ count: "wrong" }),
});
defineTool({
  name: "wrong_transform_input", inputSchema: z.object({}), outputSchema: z.string().transform(Number).pipe(z.number()),
  // @ts-expect-error execute returns the pre-transform schema input
  execute: () => 4,
});
const endpoint = createEndpoint("/api/count", { method: "GET" }, () => ({ value: 1 }));
defineConfig({ mcp: {
  tools: [{ endpoint, name: "api_count" }, native, validated, asyncValidated],
  authorize: ({ tools }) => {
    for (const tool of tools) {
      if (tool.kind === "endpoint") {
        const path: string = tool.path;
      } else {
        const path: undefined = tool.path;
      }
      // @ts-expect-error no executable handlers in the policy catalog
      tool.execute();
    }
    return { subject: "agent", tools: tools.map(tool => tool.name) };
  },
} });
// @ts-expect-error a schema is required even for zero arguments (use z.object({}))
defineTool({ name: "missing_schema", execute: () => null });
// @ts-expect-error endpoint-backed and standalone definitions cannot be combined into one tool
defineTool({ name: "ambiguous", endpoint, inputSchema: z.object({}), execute: () => null });
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
  expect(
    ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  ).toBe("");
}, 30_000);
