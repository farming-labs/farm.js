import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");

function diagnosticsFor(source: string): string {
  const filename = path.join(packageRoot, "client-native-parity.type-test.ts");
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(name) === filename
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({ rootNames: [filename], options, host });
  return ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => packageRoot,
    getNewLine: () => "\n",
  });
}

it("gives the native client the web client's exports and types", () => {
  const diagnostics = diagnosticsFor(`
import type * as web from "./src/client";
import type * as native from "./src/client.native";

// Every native export is assignable to the web export of the same name, and none is missing.
const parity: typeof web = {} as typeof native;
type Missing = Exclude<keyof typeof web, keyof typeof native>;
type Extra = Exclude<keyof typeof native, keyof typeof web>;
const noneMissing: [Missing] extends [never] ? true : false = true;
const noneExtra: [Extra] extends [never] ? true : false = true;

// The type exports match too.
const options: web.FarmAuthClientOptions = {} as native.FarmAuthClientOptions;
const credentials: web.FarmAuthCredentials = {} as native.FarmAuthCredentials;
const signUp: web.FarmAuthSignUpInput = {} as native.FarmAuthSignUpInput;

// Not vacuous: a client missing a function is rejected.
// @ts-expect-error useAuth is required
const incomplete: typeof web = {} as Omit<typeof native, "useAuth">;
`);
  expect(diagnostics).toBe("");
}, 30_000);
