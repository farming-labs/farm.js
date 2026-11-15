// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("infers plugin options at the call site and inside the plugin", () => {
  const filename = path.resolve("plugin-options.type-test.ts").replace(/\\/g, "/");
  const source = `
import { defineConfig, definePlugin, type FarmPlugin } from "@farm.js/core";
import { z } from "zod";

const securityOptions = z.object({
  frameAncestors: z.string().default("'none'"),
  reportUri: z.string().optional(),
});

// No setup: the parsed options are the state.
const security = definePlugin({
  name: "acme:security",
  options: securityOptions,
  runtime: {
    after({ state, response }) {
      const ancestors: string = state.frameAncestors;
      // @ts-expect-error an option without a default stays optional
      const reportUri: string = state.reportUri;
      return response;
    },
  },
});

security();
security({});
security({ frameAncestors: "'self'", reportUri: "https://example.com/report" });
// @ts-expect-error option types are checked at the call site
security({ frameAncestors: 1 });
// @ts-expect-error unknown options are rejected at the call site
security({ frameAncestor: "'self'" });

// setup and configure receive the options; setup's result becomes the state.
const withSetup = definePlugin({
  name: "acme:with-setup",
  options: z.object({ apiKey: z.string(), retries: z.number().default(3) }),
  configure(config, { options }) {
    const key: string = options.apiKey;
    return config;
  },
  setup({ options }) {
    const retries: number = options.retries;
    return { client: { key: options.apiKey, retries } };
  },
  runtime: {
    before({ state }) {
      const retries: number = state.client.retries;
      // @ts-expect-error state is setup's result, not the options
      const key: string = state.apiKey;
    },
  },
});
withSetup({ apiKey: "key" });
// @ts-expect-error required options cannot be left out
withSetup();
// @ts-expect-error required options cannot be left out of the object either
withSetup({});

// Plugins without options keep their exact shape and inference.
const plain = definePlugin({
  name: "acme:plain",
  setup: () => ({ count: 1 }),
  runtime: {
    before({ state }) {
      const count: number = state.count;
    },
  },
});
const asPlugin: FarmPlugin = plain;
// @ts-expect-error a plugin without options is not a factory
plain();
// @ts-expect-error options is only for plugins that declare it
definePlugin({ name: "acme:typo", setup: ({ options }) => options });

defineConfig({ plugins: [security(), withSetup({ apiKey: "key" }), plain] });
`;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: process.cwd(),
    paths: { "@farm.js/core": ["./src/index.ts"] },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === filename
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({ rootNames: [filename], options, host });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === filename);
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
  expect(formatted).toBe("");
}, 120_000);
