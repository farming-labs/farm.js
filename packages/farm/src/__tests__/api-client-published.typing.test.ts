// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("preserves the source API factory overloads through the published client entry", () => {
  const filename = path.resolve("api-client-published.type-test.ts").replace(/\\/g, "/");
  const source = `
import { createAPIClient, createApiClients, endpoint, type APIClientOptions } from "@farm.js/core/client";
import type { createAPIClient as sourceFactory } from "./dist/client";
type Router = { hello: { get: { __types: {
  body: never; query: { name: string }; response: { message: string };
} } } };
const sources = { billing: { read: endpoint.get<{ id: string }>("/api/billing/read") } };

// Require the entire exported function type to match, not just one happy-path call.
const publicAsSource: typeof sourceFactory = createAPIClient;
const sourceAsPublic: typeof createAPIClient = {} as typeof sourceFactory;
const defaults: APIClientOptions = { headers: async () => ({ "X-App": "demo" }) };
const ordinary = createAPIClient<Router>(defaults);
ordinary.hello.get({ query: { name: "Farm" } });
createAPIClient<Router>();
const routesOnly = createAPIClient<Router>({ integrations: false });
const pairControl = createApiClients<Router>({ integrations: false });
routesOnly.hello.get({ query: { name: "Farm" } }).then(result => {
  const message: string | undefined = result.data?.message;
  // @ts-expect-error response inference must not become any
  const wrong: number = result.data!.message;
});
// @ts-expect-error opting out removes the reserved caller namespace
routesOnly.integrations;
// @ts-expect-error required query input remains required
routesOnly.hello.get();
// @ts-expect-error invalid query data remains rejected
routesOnly.hello.get({ query: { name: 123 } });

const integrated = createAPIClient<Router, typeof sources>({ integrations: { headers: { "X-App": "demo" } } });
integrated.integrations.billing.read().then(result => {
  const id: string | undefined = result.data?.id;
  // @ts-expect-error integration response inference must not become any
  const wrong: number = result.data!.id;
});
// @ts-expect-error unknown integration namespaces remain rejected
integrated.integrations.missing;
// @ts-expect-error unknown routes remain rejected
integrated.missing.get();

// Disabling the namespace leaves an actual app route named integrations usable.
type RouteWithReservedName = { integrations: Router["hello"] };
createAPIClient<RouteWithReservedName>({ integrations: false }).integrations.get({ query: { name: "Farm" } });
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
