import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeContentServerModule } from "./loader.js";

const roots: string[] = [];
const bytes = Buffer.from([0, 255, 128, 10]);
const filename = `${createHash("sha256").update(bytes).digest("hex")}.pdf`;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "farm-content-staging-"));
  roots.push(root);
  const filePath = path.join(root, "guide#v1.pdf");
  const output = path.join(root, ".farm", "content", "server.mjs");
  const directory = path.join(path.dirname(output), "assets");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(filePath, bytes);
  const write = () =>
    writeContentServerModule(output, {}, new Map([["asset", { token: "asset", filePath }]]));
  return { root, filePath, output, directory, write };
}

describe("reserved content asset staging", () => {
  it("is deterministic across roots, reuses unchanged files, and changes imports on edits", async () => {
    const first = await fixture();
    const second = await fixture();
    await first.write();
    await second.write();
    const generated = await readFile(first.output, "utf8");
    expect(generated).toBe(await readFile(second.output, "utf8"));
    expect(generated).toContain(`./assets/${filename}?url`);
    const staged = path.join(first.directory, filename);
    const before = await stat(staged);
    await first.write();
    expect((await stat(staged)).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(staged)).toEqual(bytes);
    await writeFile(first.filePath, "updated");
    await first.write();
    expect(await readFile(first.output, "utf8")).not.toBe(generated);
    expect(await readFile(staged)).toEqual(bytes);
  });

  it("rejects symlinked staging directories before writing outside them", async () => {
    const { root, directory, write } = await fixture();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "keep");
    await symlink(outside, directory, "junction");
    await expect(write()).rejects.toThrow("Generated asset directory cannot be a symlink");
    expect(await readdir(outside)).toEqual(["sentinel"]);
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("keep");
  });

  it("does not follow an existing symlink at the asset destination", async () => {
    const { root, directory, write } = await fixture();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await mkdir(directory);
    await symlink(outside, path.join(directory, filename), "junction");
    await expect(write()).rejects.toThrow("not a matching regular file");
    expect(await readdir(outside)).toEqual([]);
  });

  it("refuses to overwrite unexpected existing bytes", async () => {
    const { directory, write } = await fixture();
    await mkdir(directory);
    await writeFile(path.join(directory, filename), "keep");
    await expect(write()).rejects.toThrow("not a matching regular file");
    expect(await readFile(path.join(directory, filename), "utf8")).toBe("keep");
  });
});
