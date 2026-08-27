import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkRoot = path.resolve(process.argv[2] || process.env.JS_FRAMEWORK_BENCHMARK_DIR || "");
const keyedRoot = path.join(benchmarkRoot, "frameworks", "keyed");

if (!process.argv[2] && !process.env.JS_FRAMEWORK_BENCHMARK_DIR) {
  throw new Error(
    "Pass the js-framework-benchmark checkout path or set JS_FRAMEWORK_BENCHMARK_DIR.",
  );
}

const benchmarkPackage = JSON.parse(
  await readFile(path.join(benchmarkRoot, "package.json"), "utf8"),
);
assert.equal(
  benchmarkPackage.name,
  "js-framework-benchmark",
  `${benchmarkRoot} is not a js-framework-benchmark checkout.`,
);

const variants = [
  {
    directory: "farm-react-off",
    script: "build:off",
    version: "react-19.2.0-compiler-off",
    compiled: false,
  },
  {
    directory: "farm-react-static",
    script: "build:static",
    version: "0.1.0-beta.4-static-react-19.2.0",
    compiled: true,
    reactivity: "static",
  },
  {
    directory: "farm-react-hybrid",
    script: "build:hybrid",
    version: "0.1.0-beta.4-hybrid-react-19.2.0",
    compiled: true,
    reactivity: "hybrid",
  },
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: exampleRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}.`));
    });
  });
}

function packageMetadata(variant) {
  const name = `js-framework-benchmark-${variant.directory}`;
  const packageJson = {
    name,
    version: "0.0.1",
    "js-framework-benchmark": {
      frameworkVersion: variant.version,
      frameworkHomeURL: "https://farmjs.dev/",
      language: "TypeScript",
    },
  };
  const packageLock = {
    name,
    version: "0.0.1",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name, version: "0.0.1" } },
  };
  return { packageJson, packageLock };
}

const prepared = [];
for (const variant of variants) {
  await run("pnpm", ["run", variant.script]);
  const source = await readFile(path.join(exampleRoot, "build", "dist", "main.js"), "utf8");
  const delegated = source.includes("delegateEvents:!0") || source.includes("delegateEvents:true");
  assert.equal(delegated, variant.compiled, `${variant.directory} delegation marker mismatch.`);
  assert.equal(source.includes('displayName:"Main"'), variant.compiled);
  if (variant.reactivity) assert(source.includes(`reactivity:"${variant.reactivity}"`));

  const target = path.join(keyedRoot, variant.directory);
  assert.equal(path.dirname(target), keyedRoot, "Framework target escaped frameworks/keyed.");
  await rm(target, { force: true, recursive: true });
  await mkdir(target, { recursive: true });
  await cp(path.join(exampleRoot, "build"), target, { recursive: true });
  const { packageJson, packageLock } = packageMetadata(variant);
  await writeFile(path.join(target, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(
    path.join(target, "package-lock.json"),
    `${JSON.stringify(packageLock, null, 2)}\n`,
  );

  prepared.push({
    directory: variant.directory,
    gzipBytes: gzipSync(source).byteLength,
    rawBytes: Buffer.byteLength(source),
  });
}

console.log(JSON.stringify({ benchmarkRoot, prepared }, null, 2));
