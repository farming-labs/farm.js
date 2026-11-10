import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  FarmNativeMethod,
  MobileGeneratedFile,
  MobileShellContext,
} from "@farm.js/core/mobile";
import { codegenSelector, createIosWebModules, IOS_WEB_MODULES_FILE } from "./web-modules";

const SCENE_DELEGATE = fileURLToPath(
  new URL("../../templates/ios/App/SceneDelegate.swift", import.meta.url),
);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const DEVICE: FarmNativeMethod[] = [
  { name: "model", params: [], returns: { type: "string" } },
  {
    name: "vibrate",
    params: [{ name: "ms", optional: false, type: { type: "number" } }],
    returns: { type: "void" },
  },
];

/** An app whose src/native/ has NativeDevice.ts, with `ios` as DeviceModule.mm's source. */
async function setup(options: { ios?: string; native?: boolean; methods?: FarmNativeMethod[] }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-mobile-ios-web-"));
  roots.push(root);
  const dir = path.join(root, "src/native");
  const ios: string[] = [];
  if (options.ios !== undefined) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "DeviceModule.mm"), options.ios);
    ios.push(path.join(dir, "DeviceModule.mm"));
  }
  const context = {
    root,
    os: "ios",
    command: "build",
    appModules: {
      dir,
      specs: [
        {
          name: "Device",
          file: path.join(dir, "NativeDevice.ts"),
          web: { methods: options.methods ?? DEVICE, unsupported: [] },
        },
      ],
      android: [],
      ios,
    },
    ...(options.native === false
      ? {}
      : {
          native: {
            engine: "react-native",
            reactNativeVersion: "0.88.1",
            hermesVersion: "260318099.0.5",
            modules: ["app/map"],
          },
        }),
  } as unknown as MobileShellContext;
  const files: MobileGeneratedFile[] = [
    { path: "App/SceneDelegate.swift", contents: await readFile(SCENE_DELEGATE, "utf8") },
  ];
  return { context, files };
}

const ADOPTS = "@interface DeviceModule : NSObject <NativeDeviceSpec>\n@end\n";

describe("@farm.js/mobile/ios web modules", () => {
  it("names Codegen's Objective-C selector for each Promise method", () => {
    expect(codegenSelector({ name: "model", params: [] })).toBe("model:reject:");
    expect(
      codegenSelector({
        name: "vibrate",
        params: [{ name: "ms", optional: false, type: { type: "number" } }],
      }),
    ).toBe("vibrate:resolve:reject:");
    expect(
      codegenSelector({
        name: "share",
        params: [
          { name: "title", optional: false, type: { type: "string" } },
          { name: "url", optional: true, type: { type: "string" } },
        ],
      }),
    ).toBe("share:url:resolve:reject:");
  });

  it("registers an opted-in module the iOS app has code for", async () => {
    const { context, files } = await setup({ ios: ADOPTS });
    const generated = Object.fromEntries(
      createIosWebModules(context, files).map((file) => [file.path, String(file.contents)]),
    );
    expect(Object.keys(generated).sort()).toEqual([
      IOS_WEB_MODULES_FILE,
      "App/SceneDelegate.swift",
    ]);
    const swift = generated[IOS_WEB_MODULES_FILE]!;
    expect(swift).toContain('FarmWebModule("Device", [');
    expect(swift).toContain('"model": FarmWebMethod("model:reject:", []),');
    expect(swift).toContain(
      '"vibrate": FarmWebMethod("vibrate:resolve:reject:", [FarmWebParam("ms", false, FarmWebType("number"))]),',
    );
    // It runs on the React Native engine, never through `import React`.
    expect(swift).toContain("FarmNativeScreens.engine as? ReactNativeEngine");
    expect(swift).not.toMatch(/^import React/m);
    expect(generated["App/SceneDelegate.swift"]).toContain("let plugins = farmWebModules()");
    expect(generated["App/SceneDelegate.swift"]).not.toContain("[String: FarmPlugin] = [:]");
  });

  it("describes every spec type, and keeps object parameters off iOS", async () => {
    const methods: FarmNativeMethod[] = [
      {
        name: "save",
        params: [
          { name: "kind", optional: false, type: { type: "literal", values: ["a", "b"] } },
          {
            name: "count",
            optional: true,
            type: { type: "number", integer: true, nullable: true },
          },
          {
            name: "tags",
            optional: false,
            type: { type: "array", element: { type: "string" } },
          },
          { name: "extra", optional: false, type: { type: "map" } },
        ],
        returns: { type: "void" },
      },
      {
        name: "place",
        params: [
          {
            name: "point",
            optional: false,
            type: {
              type: "object",
              properties: [{ name: "x", optional: false, type: { type: "number" } }],
            },
          },
        ],
        returns: { type: "void" },
      },
    ];
    const { context, files } = await setup({ ios: ADOPTS, methods });
    const swift = String(
      createIosWebModules(context, files).find((file) => file.path === IOS_WEB_MODULES_FILE)
        ?.contents,
    );
    expect(swift).toContain(
      '"save": FarmWebMethod("save:count:tags:extra:resolve:reject:", [' +
        'FarmWebParam("kind", false, FarmWebType("literal", values: [.string("a"), .string("b")])), ' +
        'FarmWebParam("count", true, FarmWebType("number", nullable: true, integer: true)), ' +
        'FarmWebParam("tags", false, FarmWebType("array", element: FarmWebType("string"))), ' +
        'FarmWebParam("extra", false, FarmWebType("map"))]),',
    );
    // Codegen passes `point` to Objective-C as a C++ struct: callable on Android, not on iOS.
    expect(swift).toMatch(
      /"place": FarmWebMethod\("place:resolve:reject:", \[.*\], unavailable: "Device\.place takes an object type \(point\)/,
    );
  });

  it("registers nothing when the iOS app cannot run the module", async () => {
    // No React Native on iOS: native.Device.available() stays false, as before.
    const withoutNative = await setup({ ios: ADOPTS, native: false });
    expect(createIosWebModules(withoutNative.context, withoutNative.files)).toEqual([]);
    // Android code only, or an iOS file that is not the module.
    const androidOnly = await setup({});
    expect(createIosWebModules(androidOnly.context, androidOnly.files)).toEqual([]);
    const other = await setup({
      ios: "@interface Other : NSObject <NativeDeviceSpecHelper>\n@end\n",
    });
    expect(createIosWebModules(other.context, other.files)).toEqual([]);
  });
});
