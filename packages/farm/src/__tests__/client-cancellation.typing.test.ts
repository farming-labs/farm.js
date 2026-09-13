// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("exposes cancellation and deadlines through the published client declarations", () => {
  // TypeScript normalizes compiler filenames to forward slashes, including on Windows.
  const filename = path.resolve("client-cancellation.type-test.ts").replace(/\\/g, "/");
  const source = `
import { createApiClients, createIntegrations, endpoint, type APIClientSystemError } from "@farm.js/core/client";
type Router = { hello: { get: { __types: { body: never; query: never; response: { message: string } } } } };
const sources = { demo: { read: endpoint.get<{ value: number }>("/api/demo/read") } };
const { api, apiClient } = createApiClients<Router, typeof sources>({ timeoutMs: 100, integrations: { timeoutMs: 200 } });
api.hello.get({}, { signal: AbortSignal.abort(), timeoutMs: 0 });
apiClient.hello.get({}, { signal: new AbortController().signal, timeoutMs: 50 });
apiClient.integrations.demo.read({}, { signal: AbortSignal.abort(), timeoutMs: 0 });
const explicit = createIntegrations(sources, { timeoutMs: 100 }, { timeoutMs: 200 });
const automatic = createIntegrations<typeof sources>({ timeoutMs: 100 });
explicit.api.demo.read({}, { timeoutMs: 0, signal: AbortSignal.abort() });
automatic.apiClient.demo.read({}, { timeoutMs: 50 });
function handle(error: APIClientSystemError) {
  if (error.code === "timeout" || error.code === "aborted") { const status: 0 = error.status; }
}
// @ts-expect-error deadlines are numeric
api.hello.get({}, { timeoutMs: "100" });
// @ts-expect-error signals belong to individual calls
createApiClients<Router>({ signal: AbortSignal.abort() });
// @ts-expect-error route inference remains intact
api.hello.get({ body: { missing: true } });
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
