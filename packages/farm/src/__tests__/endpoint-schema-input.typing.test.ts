// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it.each(["source", "published"])(
  "preserves input/output inference through %s declarations",
  (surface) => {
    const filename = path.resolve("endpoint-schema-input.type-test.ts").replace(/\\/g, "/");
    const source = `
import { z } from "zod";
import { createEndpoint, POST, multipart, toFormData, type TypedEndpoint, createRouteFactory } from "@farm.js/core/api";
import { createApiClients } from "@farm.js/core/client";
const body = z.object({ count: z.string().transform(Number), label: z.string().default("default") });
const query = z.object({ page: z.string().default("1").transform(Number) });
const endpoint = createEndpoint({ method: "POST", body, query }, ({ body, query }) => {
  const count: number = body.count;
  const page: number = query.page;
  const label: string = body.label;
  return { count, page, label };
});
const upload = POST({ body: multipart(z.object({ count: z.string().transform(Number) })) }, ({ body }) => body.count);
const plain = POST({ body: z.object({ count: z.number() }) }, ({ body }) => body);
type Router = { count: { post: typeof endpoint }; upload: { post: typeof upload }; plain: { post: typeof plain } };
const { api, apiClient } = createApiClients<Router>();
for (const caller of [api, apiClient]) {
  caller.count.post({ body: { count: "2" }, query: { page: "3" } });
  caller.count.post({ body: { count: "2" } });
  caller.upload.post({ body: toFormData({ count: "2" }) });
  caller.plain.post({ body: { count: 2 } });
  // @ts-expect-error handler output is not wire input
  caller.count.post({ body: { count: 2 } });
  // @ts-expect-error transformed query output is not input
  caller.count.post({ body: { count: "2" }, query: { page: 3 } });
  // @ts-expect-error multipart branding retains schema input
  caller.upload.post({ body: toFormData({ count: 2 }) });
}
endpoint({ body: { count: "2" }, query: { page: "3" } });
type Legacy = TypedEndpoint<{ count: number }, never, number>;
const legacy = createApiClients<{ old: { post: Legacy } }>().apiClient;
legacy.old.post({ body: { count: 2 } });
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
const standardCaller = createApiClients<{ standard: { post: typeof standardEndpoint } }>().apiClient;
standardCaller.standard.post({ body: { raw: "2" } });
// @ts-expect-error standard-schema output is not input
standardCaller.standard.post({ body: { parsed: 2 } });
const route = createRouteFactory().post("/api/plugin", { input: { body, query }, handler: (_, { input }) => input.body.count });
const pluginCaller = createApiClients<{ plugin: { post: typeof route.endpoint } }>().apiClient;
pluginCaller.plugin.post({ body: { count: "2" }, query: { page: "3" } });
`;
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
        "@farm.js/core/api": [surface === "source" ? "./src/api/index.ts" : "./dist/api.d.ts"],
        "@farm.js/core/client": [
          surface === "source" ? "./src/api/client.ts" : "./types/client.d.ts",
        ],
      },
    };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, fresh) =>
      name === filename
        ? ts.createSourceFile(name, source, languageVersion, true)
        : original(name, languageVersion, onError, fresh);
    const program = ts.createProgram({ rootNames: [filename], options, host });
    expect(
      ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n",
      }),
    ).toBe("");
  },
);
