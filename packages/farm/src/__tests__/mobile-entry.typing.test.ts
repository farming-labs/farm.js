// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("types a page's mobile export and the mobile block through @farm.js/core/mobile", () => {
  const filename = path.resolve("mobile-entry.type-test.ts").replace(/\\/g, "/");
  const source = `
import type {
  FarmMobileNativeConfig,
  FarmMobilePageConfig,
  FarmMobileScreen,
  FarmMobileUserConfig,
} from "@farm.js/core/mobile";
export const mobile = { presentation: "modal", prefetch: "off" } satisfies FarmMobilePageConfig;
const native = {
  engine: "react-native",
  auto: "report",
  routes: { "/map": { screen: "native", ios: "web" } },
  budgets: { appSizeMb: 12, screenOpenMs: 300, droppedFrames: 2 },
} satisfies FarmMobileNativeConfig;
const screen: FarmMobileScreen = native.routes["/map"].ios;
const block: FarmMobileUserConfig = { id: "com.example.notes", native };
// @ts-expect-error a page cannot pick its screen tier
const wrong: FarmMobilePageConfig = { native: true };
// @ts-expect-error an OS override needs the route's screen
const partial: FarmMobileNativeConfig = { routes: { "/map": { ios: "web" } } };
void [screen, block, wrong, partial];
`;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
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
