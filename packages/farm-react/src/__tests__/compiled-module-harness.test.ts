import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

type Harness = typeof import("./compiled-module-harness");
const harnesses: Harness[] = [];

async function freshHarness() {
  vi.resetModules();
  const harness = await import("./compiled-module-harness");
  harnesses.push(harness);
  return harness;
}

function source(name: string) {
  return `export function ${name}() { return <div>${name}</div>; }`;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.removeCompiledModules();
  vi.clearAllMocks();
});

it("isolates module paths and cleanup across harness evaluations in the same worker", async () => {
  const writes = vi.mocked(fs.writeFile);
  const first = await freshHarness();
  const firstResult = await first.loadCompiledAndOriginal(source("First"));
  const firstFiles = writes.mock.calls.map(([file]) => String(file));
  writes.mockClear();

  const second = await freshHarness();
  const secondResult = await second.loadCompiledAndOriginal(source("Second"));
  const secondFiles = writes.mock.calls.map(([file]) => String(file));
  expect(firstFiles).toHaveLength(2);
  expect(secondFiles).toHaveLength(2);
  expect(dirname(firstFiles[0])).not.toBe(dirname(secondFiles[0]));
  expect(typeof firstResult.original.First).toBe("function");
  expect(typeof firstResult.compiled.First).toBe("function");
  expect(typeof secondResult.original.Second).toBe("function");
  expect(typeof secondResult.compiled.Second).toBe("function");

  await first.removeCompiledModules();
  for (const file of secondFiles) await expect(fs.stat(file)).resolves.toBeDefined();
  await first.removeCompiledModules();
});

it("uses fresh module paths after cleanup within one harness", async () => {
  const writes = vi.mocked(fs.writeFile);
  const harness = await freshHarness();
  await harness.loadCompiledAndOriginal(source("BeforeCleanup"));
  const before = writes.mock.calls.map(([file]) => String(file));
  await harness.removeCompiledModules();
  writes.mockClear();

  const result = await harness.loadCompiledAndOriginal(source("AfterCleanup"));
  const after = writes.mock.calls.map(([file]) => String(file));
  expect(dirname(after[0])).not.toBe(dirname(before[0]));
  expect(typeof result.original.AfterCleanup).toBe("function");
  expect(typeof result.compiled.AfterCleanup).toBe("function");
});

it("gives concurrent loads distinct files in one owned directory", async () => {
  const writes = vi.mocked(fs.writeFile);
  const harness = await freshHarness();
  const names = ["Alpha", "Beta", "Gamma"];
  const results = await Promise.all(
    names.map((name) => harness.loadCompiledAndOriginal(source(name))),
  );
  const files = writes.mock.calls.map(([file]) => String(file));
  expect(new Set(files).size).toBe(6);
  expect(new Set(files.map((file) => dirname(file))).size).toBe(1);
  for (const [index, name] of names.entries()) {
    expect(typeof results[index].compiled[name]).toBe("function");
    expect(typeof results[index].original[name]).toBe("function");
  }
  await harness.removeCompiledModules();
  await expect(fs.stat(dirname(files[0]))).rejects.toMatchObject({ code: "ENOENT" });
});
