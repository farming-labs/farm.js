// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("exposes shared lifecycle hooks through the published client declarations", () => {
  // TypeScript normalizes compiler filenames to forward slashes, including on Windows.
  const filename = path.resolve("client-lifecycle-hooks.type-test.ts").replace(/\\/g, "/");
  const source = `
import { createApiClients, createIntegrations, endpoint, type ClientLifecycleHooks } from "@farm.js/core/client";
type Router = { hello: { get: { __types: { body: never; query: never; response: { message: string } } } } };
const sources = { demo: { read: endpoint.get<{ value: number }>("/api/demo/read") } };
const hooks: ClientLifecycleHooks = {
  onRequest(event) { const method: string = event.method; },
  onResponse(data, error, event) { const status: number | undefined = event.status;
    // @ts-expect-error a shared observer cannot assume one route's shape
    data.message;
  },
  onError(error) { const message: string = error.message; }
};
const { api, apiClient } = createApiClients<Router, typeof sources>({ ...hooks, integrations: hooks });
api.hello.get({}, { onResponse(data) { const message: string | undefined = data?.message; } });
apiClient.integrations.demo.read({}, { onResponse(data) {
  const value: number | undefined = data?.value;
  // @ts-expect-error integration per-call response data remains typed
  data?.missing;
} });
const pair = createIntegrations(sources, hooks, hooks);
pair.api.demo.read({}, { onResponse(data) { const value: number | undefined = data?.value; } });
createIntegrations<typeof sources>({ onError: hooks.onError }).apiClient.demo.read();
// @ts-expect-error a request observer receives an event, not a number
createApiClients<Router>({ onRequest: (value: number) => {} });
`;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: process.cwd(),
    paths: { "@farm.js/core/client": ["./types/client.d.ts"] },
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
