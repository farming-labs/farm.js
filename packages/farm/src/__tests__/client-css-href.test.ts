import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FARM_CLIENT_CSS_HREF_PLACEHOLDER,
  resolveHashedClientCssHref,
} from "../nitro/client-css-href";

const tempDirs: string[] = [];

async function makeClientOutputDir(css?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-client-css-"));
  tempDirs.push(dir);
  if (css !== undefined) {
    await fs.writeFile(path.join(dir, "farm-client.css"), css);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("resolveHashedClientCssHref", () => {
  it("copies the stylesheet to a fingerprinted assets path and returns its href", async () => {
    const dir = await makeClientOutputDir("body { color: red; }");

    const href = await resolveHashedClientCssHref(dir);

    expect(href).toMatch(/^\/assets\/farm-client-h[0-9a-f]{8}\.css$/);
    const copied = await fs.readFile(path.join(dir, href.slice(1)), "utf8");
    expect(copied).toBe("body { color: red; }");
    // The stable file stays for anything that hardcoded its path.
    await expect(fs.readFile(path.join(dir, "farm-client.css"), "utf8")).resolves.toBe(
      "body { color: red; }",
    );
  });

  it("changes the href when the stylesheet bytes change", async () => {
    const first = await resolveHashedClientCssHref(await makeClientOutputDir("a{}"));
    const second = await resolveHashedClientCssHref(await makeClientOutputDir("b{}"));
    const firstAgain = await resolveHashedClientCssHref(await makeClientOutputDir("a{}"));

    expect(first).not.toBe(second);
    expect(first).toBe(firstAgain);
  });

  it("falls back to the stable name for empty or missing stylesheets", async () => {
    await expect(resolveHashedClientCssHref(await makeClientOutputDir(""))).resolves.toBe(
      "/farm-client.css",
    );
    await expect(resolveHashedClientCssHref(await makeClientOutputDir())).resolves.toBe(
      "/farm-client.css",
    );
  });

  it("produces hrefs the placeholder can never collide with", () => {
    // Substitution is a plain string replace over generated code, so the
    // placeholder must not be a substring any real href could contain.
    expect(FARM_CLIENT_CSS_HREF_PLACEHOLDER).toMatch(/^\/__[a-z_]+__$/);
  });
});
