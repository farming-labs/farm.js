// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("exposes custom fetch through the published client declarations", () => {
  // TypeScript normalizes compiler filenames to forward slashes, including on Windows.
  const filename = path.resolve("client-fetch.type-test.ts").replace(/\\/g, "/");
  const source = `
import { createApiClients, createIntegrations, endpoint, type APIClientOptions, type IntegrationClientOptions } from "@farm.js/core/client";
type Router = { hello: { get: { __types: { body: never; query: never; response: { message: string } } } } };
const sources = { demo: { read: endpoint.get<{ value: number }>("/api/demo/read") } };
const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
const options: APIClientOptions = { fetch, integrations: { fetch } };
const integrationOptions: IntegrationClientOptions = { fetch };
const { api, apiClient } = createApiClients<Router, typeof sources>(options);
api.hello.get();
apiClient.integrations.demo.read();
createIntegrations(sources, integrationOptions, { fetch }).api.demo.read();
createIntegrations<typeof sources>({ fetch }).apiClient.demo.read();
// @ts-expect-error a transport must return a Response
createApiClients<Router>({ fetch: async () => ({ value: 1 }) });
// @ts-expect-error fetch is an instance option, not a per-call option
apiClient.hello.get({}, { fetch });
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
