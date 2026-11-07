// @vitest-environment node

import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateFarmTypeArtifacts } from "../type-artifacts";
import { readFarmMobileWebModules, scanFarmMobileAppModules } from "../mobile/modules";
import {
  createFarmNativeModuleTypeDeclarations,
  readFarmNativeWebSpec,
} from "../mobile/native-specs";

/** The mobile example: its own react-native install, and the Device spec. */
const EXAMPLE = fileURLToPath(new URL("../../../../examples/mobile/", import.meta.url));
const REACT_NATIVE = realpathSync(path.join(EXAMPLE, "node_modules/react-native"));

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

/** An app with react-native installed (the example's) and the given files. */
async function createApp(files: Record<string, string>, reactNative = true): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-native-specs-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "notes" }));
  if (reactNative) {
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.symlink(REACT_NATIVE, path.join(root, "node_modules/react-native"), "junction");
  }
  for (const [name, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), contents);
  }
  return root;
}

const KITCHEN = `import { TurboModuleRegistry, type TurboModule, type CodegenTypes } from "react-native";

export type Mode = "light" | "dark";
export type Point = { x: number; y?: number | null };
export enum Level {
  Low = "low",
  High = "high",
}

export interface Spec extends TurboModule {
  scalars(s: string, n: number, b: boolean, i: CodegenTypes.Int32): Promise<string>;
  shapes(mode: Mode, point: Point, tags: Array<string>, extra: Object, note?: string | null): Promise<Point>;
  levels(level: Level, points: ReadonlyArray<Point>): Promise<Array<number>>;
  done(): Promise<void>;
  syncValue(): string;
  withCallback(callback: (value: string) => void): void;
  readonly getConstants: () => { version: string };
}

export default TurboModuleRegistry.getEnforcing<Spec>("Kitchen");
`;

describe("native module specs for web screens", () => {
  it("reads the Promise methods of the mobile example's Device spec with React Native's Codegen", () => {
    expect(
      readFarmNativeWebSpec({
        root: EXAMPLE,
        file: path.join(EXAMPLE, "src/native/NativeDevice.ts"),
      }),
    ).toEqual({
      methods: [
        { name: "model", params: [], returns: { type: "string" } },
        {
          name: "vibrate",
          params: [{ name: "ms", optional: false, type: { type: "number" } }],
          returns: { type: "void" },
        },
        // A file by reference: web screens get a /__farm/files/<id> URL, null when cancelled.
        { name: "pickPhoto", params: [], returns: { type: "string", nullable: true } },
      ],
      unsupported: [],
    });
  });

  it("maps every type Codegen exposes, and leaves out methods that are not Promises", async () => {
    const root = await createApp({ "src/native/NativeKitchen.ts": KITCHEN });
    const spec = readFarmNativeWebSpec({
      root,
      file: path.join(root, "src/native/NativeKitchen.ts"),
    });
    const point = {
      type: "object",
      properties: [
        { name: "x", optional: false, type: { type: "number" } },
        { name: "y", optional: true, type: { type: "number", nullable: true } },
      ],
    };
    expect(spec).toEqual({
      methods: [
        {
          name: "scalars",
          params: [
            { name: "s", optional: false, type: { type: "string" } },
            { name: "n", optional: false, type: { type: "number" } },
            { name: "b", optional: false, type: { type: "boolean" } },
            { name: "i", optional: false, type: { type: "number", integer: true } },
          ],
          returns: { type: "string" },
        },
        {
          name: "shapes",
          params: [
            { name: "mode", optional: false, type: { type: "literal", values: ["light", "dark"] } },
            { name: "point", optional: false, type: point },
            {
              name: "tags",
              optional: false,
              type: { type: "array", element: { type: "string" } },
            },
            { name: "extra", optional: false, type: { type: "map" } },
            { name: "note", optional: true, type: { type: "string", nullable: true } },
          ],
          returns: point,
        },
        {
          name: "levels",
          params: [
            { name: "level", optional: false, type: { type: "literal", values: ["low", "high"] } },
            { name: "points", optional: false, type: { type: "array", element: point } },
          ],
          returns: { type: "array", element: { type: "number" } },
        },
        { name: "done", params: [], returns: { type: "void" } },
      ],
      unsupported: [],
    });

    expect(
      createFarmNativeModuleTypeDeclarations(
        [{ name: "Kitchen", file: path.join(root, "src/native/NativeKitchen.ts") }],
        { root },
      ),
    ).toBe(`/**
 * Auto-generated from the Codegen specs in src/native: native.<module> from @farm.js/core/native.
 * Web screens reach a module's Promise methods only when mobile.modules.<name>.web is true, and
 * only inside the mobile shell; check native.<module>.available() first.
 */
declare module "@farm.js/core/native" {
  interface FarmNativeModules {
    Kitchen: {
      scalars(s: string, n: number, b: boolean, i: number): Promise<string>;
      shapes(mode: "light" | "dark", point: { x: number; y?: number | null }, tags: Array<string>, extra: Record<string, unknown>, note?: string | null): Promise<{ x: number; y?: number | null }>;
      levels(level: "low" | "high", points: Array<{ x: number; y?: number | null }>): Promise<Array<number>>;
      done(): Promise<void>;
    };
  }
}`);
  });

  it("fails an opted-in module whose Promise methods web screens cannot call, naming each", async () => {
    const root = await createApp({
      "src/native/NativeKitchen.ts": KITCHEN.replace(
        "  done(): Promise<void>;",
        "  done(): Promise<void>;\n  watch(callback: (value: string) => void): Promise<void>;\n  available(): Promise<boolean>;",
      ),
      "src/native/NativeQuiet.ts": `import { TurboModuleRegistry, type TurboModule } from "react-native";
export interface Spec extends TurboModule {
  value(): string;
}
export default TurboModuleRegistry.getEnforcing<Spec>("Quiet");
`,
      "src/native/NativeOff.ts": KITCHEN.replace('"Kitchen"', '"Off"'),
    });
    const app = scanFarmMobileAppModules({ root })!;
    const on = { permissions: [], usage: {}, web: true };
    expect(() =>
      readFarmMobileWebModules(
        app,
        { Kitchen: on, Quiet: on, Off: { ...on, web: false } },
        { root },
      ),
    ).toThrow(
      [
        "modules has 3 problems:",
        '  - modules["Kitchen"].web: src/native/NativeKitchen.ts declares watch(), but its parameter callback is a callback, which a web screen cannot send. Change the parameter to a string, number, boolean, object, or array, or remove web and call the module from a native screen (page.native.tsx).',
        '  - modules["Kitchen"].web: src/native/NativeKitchen.ts declares available(), which web screens use to check for the module (native.<module>.available()). Rename the method.',
        '  - modules["Quiet"].web: src/native/NativeQuiet.ts declares no method that returns a Promise, and web screens call only those. Remove web, or declare one, such as model(): Promise<string>.',
      ].join("\n"),
    );
    // Only opted-in specs carry what web screens may call.
    const read = readFarmMobileWebModules(
      { ...app, specs: app.specs.filter((spec) => spec.name === "Off") },
      { Off: on },
      { root },
    );
    expect(read.specs[0]!.web!.methods.map((method) => method.name)).toEqual([
      "scalars",
      "shapes",
      "levels",
      "done",
    ]);
    expect(
      readFarmMobileWebModules(app, { Off: { ...on, web: false } }, { root }).specs.some(
        (spec) => spec.web,
      ),
    ).toBe(false);
  });

  it("names the fix when React Native's Codegen is not installed", async () => {
    const root = await createApp({ "src/native/NativeKitchen.ts": KITCHEN }, false);
    expect(() =>
      readFarmNativeWebSpec({ root, file: path.join(root, "src/native/NativeKitchen.ts") }),
    ).toThrow(
      "Reading a native module spec needs React Native's Codegen (@react-native/codegen, installed with react-native). Add react-native to the app's dependencies and install them.",
    );
    // Types only check web pages, so a pruned production install builds without them.
    expect(
      createFarmNativeModuleTypeDeclarations(
        [{ name: "Kitchen", file: path.join(root, "src/native/NativeKitchen.ts") }],
        { root },
      ),
    ).toBeUndefined();
  });

  it("types native.<module> in src/farm.d.ts only for apps with specs", async () => {
    const root = await createApp({
      "src/app/page.tsx": "export default function Page() { return null; }\n",
      "src/native/NativeDevice.ts": await fs.readFile(
        path.join(EXAMPLE, "src/native/NativeDevice.ts"),
        "utf8",
      ),
    });
    await generateFarmTypeArtifacts({ root, api: false });
    const types = await fs.readFile(path.join(root, "src/farm.d.ts"), "utf8");
    expect(types).toContain(`declare module "@farm.js/core/native" {
  interface FarmNativeModules {
    Device: {
      model(): Promise<string>;
      vibrate(ms: number): Promise<void>;
      pickPhoto(): Promise<string | null>;
    };
  }
}`);

    const plain = await createApp({
      "src/app/page.tsx": "export default function Page() { return null; }\n",
    });
    await generateFarmTypeArtifacts({ root: plain, api: false });
    expect(await fs.readFile(path.join(plain, "src/farm.d.ts"), "utf8")).not.toContain(
      "@farm.js/core/native",
    );
  });
});
