// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("types renames from the plugin's own schema", () => {
  const filename = path.resolve("plugin-schema.type-test.ts").replace(/\\/g, "/");
  const source = `
import { defineConfig, definePlugin, defineSchema, renameSchema, type FarmSchemaRenames } from "@farm.js/core";

const teamsSchema = defineSchema({
  models: {
    user: { external: true, fields: { id: { type: "string", primaryKey: true } } },
    member: { fields: { id: { type: "uuid", primaryKey: true }, userId: { type: "string" } } },
  },
});

export function teams(options: { schema?: FarmSchemaRenames<typeof teamsSchema> } = {}) {
  return definePlugin({ name: "farm:teams", schema: renameSchema(teamsSchema, options.schema) });
}

teams();
teams({ schema: { user: { name: "members_auth", fields: { id: "user_id" } } } });
teams({ schema: { member: { fields: { userId: "user_ref" } } } });
// @ts-expect-error models are the plugin's own
teams({ schema: { usr: { name: "members_auth" } } });
// @ts-expect-error fields are the model's own
teams({ schema: { user: { fields: { userId: "user_id" } } } });
// @ts-expect-error names are strings
teams({ schema: { user: { name: 1 } } });

defineConfig({ plugins: [teams({ schema: { user: { name: "members_auth" } } })] });

definePlugin({ name: "farm:jobs", schema: teamsSchema, database: { client: () => ({}), dialect: "postgres" } });
// @ts-expect-error dialects are the ones Farm migrates
definePlugin({ name: "farm:jobs", schema: teamsSchema, database: { client: {}, dialect: "oracle" } });
// @ts-expect-error a database needs its client
definePlugin({ name: "farm:jobs", schema: teamsSchema, database: { dialect: "sqlite" } });
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
