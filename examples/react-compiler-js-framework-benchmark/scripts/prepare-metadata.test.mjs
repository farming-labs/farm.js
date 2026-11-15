import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertCompilerOutput,
  benchmarkVariants,
  readBenchmarkVersions,
} from "./prepare-metadata.mjs";

async function installedFixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-benchmark-versions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { react: "^99.0.0" } }),
  );
  for (const [name, version] of Object.entries({
    "@farm.js/react": "0.2.0-beta.42",
    react: "19.3.7",
    "react-dom": "19.3.7",
    ...overrides,
  })) {
    const directory = path.join(root, "node_modules", name);
    await mkdir(directory, { recursive: true });
    const exports =
      name === "@farm.js/react"
        ? { "./vite": "./dist/vite.cjs" }
        : { "./package.json": "./package.json" };
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name, version, exports }),
    );
    if (name === "@farm.js/react") {
      await mkdir(path.join(directory, "dist"));
      await writeFile(path.join(directory, "dist/vite.cjs"), "");
    }
  }
  return root;
}

test("reads concrete installed versions through the renderer export, not dependency ranges", async (t) => {
  assert.deepEqual(await readBenchmarkVersions(await installedFixture(t)), {
    farm: "0.2.0-beta.42",
    react: "19.3.7",
    reactDom: "19.3.7",
  });
});

test("rejects mismatched React and React DOM before preparing artifacts", async (t) => {
  await assert.rejects(
    readBenchmarkVersions(await installedFixture(t, { "react-dom": "19.3.8" })),
    /versions must match/,
  );
});

test("does not publish an undefined or unresolved version label", async (t) => {
  for (const version of [undefined, "workspace:*", ""]) {
    await assert.rejects(
      readBenchmarkVersions(await installedFixture(t, { "@farm.js/react": version })),
      /no concrete installed version/,
    );
  }
});

test("labels the installed compiler and React versions, not a historical release", () => {
  const variants = benchmarkVariants({ farm: "0.2.0-beta.42", react: "19.3.7" });
  assert.deepEqual(
    variants.map(({ version }) => version),
    [
      "react-19.3.7-compiler-off",
      "0.2.0-beta.42-static-react-19.3.7",
      "0.2.0-beta.42-hybrid-react-19.3.7",
    ],
  );
});

for (const quote of ['"', "'", "`"]) {
  for (const reactivity of ["static", "hybrid"]) {
    test(`accepts ${reactivity} output with ${quote} quotes`, () => {
      assertCompilerOutput(
        `delegateEvents:!0,displayName:${quote}Main${quote},reactivity:${quote}${reactivity}${quote}`,
        {
          directory: "fixture",
          compiled: true,
          reactivity,
        },
      );
    });
  }
}

test("still rejects a missing compiler, missing delegation, and the wrong mode", () => {
  const variant = { directory: "fixture", compiled: true, reactivity: "hybrid" };
  assert.throws(() => assertCompilerOutput("", variant));
  assert.throws(() => assertCompilerOutput('displayName:"Main",reactivity:"hybrid"', variant));
  assert.throws(() =>
    assertCompilerOutput('delegateEvents:!0,displayName:"Main",reactivity:"static"', variant),
  );
  assert.throws(() =>
    assertCompilerOutput('delegateEvents:!0,displayName:"Other",reactivity:"hybrid"', variant),
  );
});

test("compiler-off must not contain compiled Main or delegation markers", () => {
  const variant = { directory: "off", compiled: false };
  assertCompilerOutput("React.createElement(Main)", variant);
  assert.throws(() => assertCompilerOutput('displayName:"Main"', variant));
  assert.throws(() => assertCompilerOutput("delegateEvents:!0", variant));
});

test("supports whitespace and boolean markers without accepting malformed quotes", () => {
  const variant = { directory: "fixture", compiled: true, reactivity: "hybrid" };
  assertCompilerOutput("delegateEvents: true, displayName: 'Main', reactivity: `hybrid`", variant);
  assert.throws(() =>
    assertCompilerOutput("delegateEvents:true,displayName:'Main`,reactivity:`hybrid`", variant),
  );
  assert.throws(() =>
    assertCompilerOutput("delegateEvents:true,displayName:'Main',reactivity:`hybrid'", variant),
  );
});
