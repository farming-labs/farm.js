// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

type DeclarationSurface = "source" | "published";

function createTypeTestSource(surface: DeclarationSurface): string {
  // Keep the source fixture on the endpoint contracts themselves. The published
  // fixture covers the generated client mapping without loading that runtime
  // implementation into a second compiler graph.
  const imports =
    surface === "source"
      ? `
import { createEndpoint, POST, type TypedEndpoint } from "./src/api/endpoint";
import { createRouteFactory } from "./src/api/route";
import { multipart, toFormData } from "./src/api/transport";
`
      : `
import { createEndpoint, POST, multipart, toFormData, type TypedEndpoint, createRouteFactory } from "@farm.js/core/api";
import { createApiClients } from "@farm.js/core/client";
`;
  const assertions =
    surface === "source"
      ? `
endpoint({ body: { count: "2" }, query: { page: "3" }, headers: { "x-count": "4" } });
endpoint({ body: { count: "2" }, headers: { "x-count": "4" } });
upload({ body: toFormData({ count: "2" }) });
plain({ body: { count: 2 } });
// @ts-expect-error handler output is not wire input
endpoint({ body: { count: 2 }, headers: { "x-count": "4" } });
// @ts-expect-error transformed query output is not input
endpoint({ body: { count: "2" }, query: { page: 3 }, headers: { "x-count": "4" } });
// @ts-expect-error transformed header output is not input
endpoint({ body: { count: "2" }, headers: { "x-count": 4 } });
// @ts-expect-error multipart branding retains schema input
upload({ body: toFormData({ count: 2 }) });
declare const legacy: Legacy;
legacy({ body: { count: 2 } });
standardEndpoint({ body: { raw: "2" } });
// @ts-expect-error standard-schema output is not input
standardEndpoint({ body: { parsed: 2 } });
route.endpoint({ body: { count: "2" }, query: { page: "3" } });
`
      : `
const { api, apiClient } = createApiClients<Router>();
for (const caller of [api, apiClient]) {
  caller.count.post({ body: { count: "2" }, query: { page: "3" }, headers: { "x-count": "4" } });
  caller.count.post({ body: { count: "2" }, headers: { "x-count": "4" } });
  caller.upload.post({ body: toFormData({ count: "2" }) });
  caller.plain.post({ body: { count: 2 } });
  // @ts-expect-error handler output is not wire input
  caller.count.post({ body: { count: 2 }, headers: { "x-count": "4" } });
  // @ts-expect-error transformed query output is not input
  caller.count.post({ body: { count: "2" }, query: { page: 3 }, headers: { "x-count": "4" } });
  // @ts-expect-error transformed header output is not input
  caller.count.post({ body: { count: "2" }, headers: { "x-count": 4 } });
  // @ts-expect-error required header input remains required
  caller.count.post({ body: { count: "2" } });
  // @ts-expect-error multipart branding retains schema input
  caller.upload.post({ body: toFormData({ count: 2 }) });
}
const legacy = createApiClients<{ old: { post: Legacy } }>().apiClient;
legacy.old.post({ body: { count: 2 } });
const standardCaller = createApiClients<{ standard: { post: typeof standardEndpoint } }>().apiClient;
standardCaller.standard.post({ body: { raw: "2" } });
// @ts-expect-error standard-schema output is not input
standardCaller.standard.post({ body: { parsed: 2 } });
const pluginCaller = createApiClients<{ plugin: { post: typeof route.endpoint } }>().apiClient;
pluginCaller.plugin.post({ body: { count: "2" }, query: { page: "3" } });
`;

  return `
import { z } from "zod";
${imports}
const body = z.object({ count: z.string().transform(Number), label: z.string().default("default") });
const query = z.object({ page: z.string().default("1").transform(Number) });
const headers = z.object({ "x-count": z.string().transform(Number), "x-label": z.string().default("farm") });
const endpoint = createEndpoint({ method: "POST", body, query, headers, mcp: { name: "create_count" } }, ({ body, query, headers }) => {
  const count: number = body.count;
  const page: number = query.page;
  const label: string = body.label;
  const headerCount: number = headers["x-count"];
  return { count, page, label, headerCount };
});
const upload = POST({ body: multipart(z.object({ count: z.string().transform(Number) })) }, ({ body }) => body.count);
const plain = POST({ body: z.object({ count: z.number() }) }, ({ body }) => body);
type Router = { count: { post: typeof endpoint }; upload: { post: typeof upload }; plain: { post: typeof plain } };
type Legacy = TypedEndpoint<{ count: number }, never, number>;
const standard = {
  "~standard": {
    version: 1 as const, vendor: "test",
    types: undefined as { input: { raw: string }; output: { parsed: number } } | undefined,
    validate: (_value: unknown) => ({ value: { parsed: 2 } }),
  },
};
const standardEndpoint = POST({ body: standard }, ({ body }) => {
  const parsed: number = body.parsed;
  return parsed;
});
const route = createRouteFactory().post("/api/plugin", { mcp: true, input: { body, query }, handler: (_, { input }) => input.body.count });
${assertions}
`;
}

it("preserves input/output inference through source and published declarations", () => {
  const sourceFilename = path
    .resolve("endpoint-schema-input.source.type-test.ts")
    .replace(/\\/g, "/");
  const publishedFilename = path
    .resolve("endpoint-schema-input.published.type-test.ts")
    .replace(/\\/g, "/");
  const sources = new Map([
    [sourceFilename, createTypeTestSource("source")],
    [publishedFilename, createTypeTestSource("published")],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    baseUrl: process.cwd(),
    paths: {
      "@farm.js/core/api": ["./dist/api.d.ts"],
      "@farm.js/core/client": ["./types/client.d.ts"],
    },
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, fresh) => {
    const source = sources.get(name.replace(/\\/g, "/"));
    return source
      ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, onError, fresh);
  };
  const program = ts.createProgram({
    rootNames: [sourceFilename, publishedFilename],
    options,
    host,
  });
  expect(
    ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  ).toBe("");
});
