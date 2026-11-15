import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export async function readBenchmarkVersions(exampleRoot) {
  const require = createRequire(path.join(exampleRoot, "package.json"));
  async function version(file, name) {
    const manifest = JSON.parse(await readFile(file, "utf8"));
    assert.equal(manifest.name, name, `Unexpected benchmark dependency at ${file}.`);
    assert(
      typeof manifest.version === "string" &&
        /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(manifest.version),
      `${name} has no concrete installed version.`,
    );
    return manifest.version;
  }
  // Farm exposes dist/vite, but deliberately does not export package.json.
  const farm = await version(
    path.resolve(path.dirname(require.resolve("@farm.js/react/vite")), "../package.json"),
    "@farm.js/react",
  );
  const react = await version(require.resolve("react/package.json"), "react");
  const reactDom = await version(require.resolve("react-dom/package.json"), "react-dom");
  assert.equal(reactDom, react, "Benchmark React and React DOM versions must match.");
  return { farm, react, reactDom };
}

export function benchmarkVariants({ farm, react }) {
  return [
    {
      directory: "farm-react-off",
      script: "build:off",
      version: `react-${react}-compiler-off`,
      compiled: false,
    },
    {
      directory: "farm-react-static",
      script: "build:static",
      version: `${farm}-static-react-${react}`,
      compiled: true,
      reactivity: "static",
    },
    {
      directory: "farm-react-hybrid",
      script: "build:hybrid",
      version: `${farm}-hybrid-react-${react}`,
      compiled: true,
      reactivity: "hybrid",
    },
  ];
}

export function assertCompilerOutput(source, variant) {
  const delegated = /\bdelegateEvents\s*:\s*(?:!0|true)\b/.test(source);
  assert.equal(delegated, variant.compiled, `${variant.directory} delegation marker mismatch.`);
  assert.equal(
    /\bdisplayName\s*:\s*(["'`])Main\1/.test(source),
    variant.compiled,
    `${variant.directory} Main compilation marker mismatch.`,
  );
  if (variant.reactivity) {
    const reactivity = source.match(/\breactivity\s*:\s*(["'`])(static|hybrid)\1/)?.[2];
    assert.equal(
      reactivity,
      variant.reactivity,
      `${variant.directory} reactivity marker mismatch.`,
    );
  }
}
