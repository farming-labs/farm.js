import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

/** Node's exports-condition matching: the first key, in object order, the resolver accepts. */
function resolveExport(subpath: string, conditions: string[]): string | null {
  const resolve = (target: unknown): string | null => {
    if (typeof target === "string") return target;
    if (!target || typeof target !== "object") return null;
    for (const [key, value] of Object.entries(target)) {
      if (key === "default" || conditions.includes(key)) {
        const resolved = resolve(value);
        if (resolved) return resolved;
      }
    }
    return null;
  };
  return resolve(manifest.exports[subpath]);
}

/** The JS files tsc emits for `entry` and the modules it reaches, by name. */
function emitFrom(entry: string): Map<string, string> {
  const configPath = path.join(packageRoot, "tsconfig.json");
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  if (!config) throw new Error("Could not read tsconfig.json");
  const options = { ...config.options, declaration: false, declarationMap: false, noEmit: false };
  const program = ts.createProgram({ rootNames: [path.join(packageRoot, entry)], options });
  const files = new Map<string, string>();
  program.emit(undefined, (fileName, text) => {
    if (fileName.endsWith(".js")) files.set(path.relative(options.outDir!, fileName), text);
  });
  return files;
}

function runtimeImports(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)].map(
    (match) => match[1]!,
  );
}

describe("@farm.js/auth/client entries", () => {
  it("resolves the native build only under the react-native condition", () => {
    // Metro (React Native) resolves `react-native`; nothing else does.
    expect(resolveExport("./client", ["react-native", "require", "import"])).toBe(
      "./dist/client.native.js",
    );
    // Vite's browser and SSR builds, Node, and TypeScript keep the web client and its types.
    expect(
      resolveExport("./client", ["browser", "module", "import", "development", "production"]),
    ).toBe("./dist/client.js");
    expect(resolveExport("./client", ["node", "import"])).toBe("./dist/client.js");
    expect(resolveExport("./client", ["node", "require"])).toBe("./dist/client.js");
    expect(resolveExport("./client", ["types", "import"])).toBe("./dist/client.d.ts");

    const keys = Object.keys(manifest.exports["./client"] as object);
    expect(keys.indexOf("react-native")).toBeLessThan(keys.indexOf("import"));
    expect(keys.indexOf("react-native")).toBeLessThan(keys.indexOf("default"));
    for (const subpath of [".", "./server", "./internal"]) {
      expect(JSON.stringify(manifest.exports[subpath])).not.toContain("native");
    }
  });

  it("keeps @farm.js/native an optional peer, never an install dependency", () => {
    expect(manifest.dependencies).not.toHaveProperty("@farm.js/native");
    expect(manifest.peerDependencies).toHaveProperty("@farm.js/native");
    expect(manifest.peerDependenciesMeta?.["@farm.js/native"]?.optional).toBe(true);
  });

  it("emits the web entry without any native module", () => {
    const web = emitFrom("src/client.ts");

    expect([...web.keys()].sort()).toEqual(["client.js", "types.js"]);
    for (const [file, source] of web) {
      expect(source, file).not.toContain("@farm.js/native");
      expect(source, file).not.toContain("client.native");
    }
    expect(runtimeImports(web.get("client.js")!)).toEqual(["better-auth/react"]);
  });

  it("emits the native entry as its own file, the only one importing @farm.js/native", () => {
    const native = emitFrom("src/client.native.ts");

    expect(native.has("client.native.js")).toBe(true);
    // The web client is a type-only import here: erased, so Metro never loads better-auth/react.
    expect(runtimeImports(native.get("client.native.js")!).sort()).toEqual(
      ["./config.js", "@farm.js/native", "react"].sort(),
    );
    expect(runtimeImports(native.get("config.js") ?? "")).toEqual([]);
  });
});
