// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("exposes header resolvers through the published client declarations", () => {
  // TypeScript normalizes compiler filenames to forward slashes, including on Windows.
  const filename = path.resolve("client-headers.type-test.ts").replace(/\\/g, "/");
  const source = `
import {
  createAPIClient, createApiClients, createIntegrations, endpoint,
  type ClientHeaders, type APIClientOptions, type IntegrationClientOptions,
} from "@farm.js/core/client";

type Router = { hello: { get: { __types: {
  body: never; query: never; response: { message: string };
} } } };
const sources = { demo: { session: endpoint.get<{ user: string }>("/api/demo/session") } };
const values: ClientHeaders[] = [
  { "X-App": "demo" },
  () => ({ "X-App": "demo" }),
  async () => ({ "X-App": "demo" }),
];
for (const headers of values) {
  const options: APIClientOptions = { headers, integrations: { headers } };
  const integrationOptions: IntegrationClientOptions = { headers };
  const { api, apiClient } = createApiClients<Router, typeof sources>(options);
  const routesOnly = createApiClients<Router>({ headers, integrations: false }).apiClient;
  createAPIClient<Router>({ headers });
  const integrationOnly = createIntegrations<typeof sources>(integrationOptions, { headers });
  const explicit = createIntegrations(sources, integrationOptions, { headers });
  api.hello.get().then(result => { const value: string | undefined = result.data?.message; });
  apiClient.integrations.demo.session().then(result => { const value: string | undefined = result.data?.user; });
  routesOnly.hello.get();
  integrationOnly.api.demo.session({}, { headers: { "X-Call": "demo" } });
  explicit.apiClient.demo.session();
  // @ts-expect-error per-call headers are objects, not resolvers
  integrationOnly.apiClient.demo.session({}, { headers: () => ({ "X-Call": "demo" }) });
  // @ts-expect-error route inference must remain intact
  api.missing.get();
}
// @ts-expect-error resolver values must be strings
const wrong: ClientHeaders = () => ({ "X-App": 123 });
// @ts-expect-error async resolvers must return a header object
const wrongAsync: ClientHeaders = async () => "not headers";
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
