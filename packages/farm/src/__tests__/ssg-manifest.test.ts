// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServerRenderer, shouldServePrerenderedPage } from "../server/renderer";

const tempDirs = new Set<string>();

function createRenderer(manifest?: string): ServerRenderer {
  const root = mkdtempSync(path.join(tmpdir(), "farm-ssg-manifest-"));
  tempDirs.add(root);

  if (manifest !== undefined) {
    const outDir = path.join(root, "dist");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "__ssg_manifest.json"), manifest);
  }

  return new ServerRenderer({ root, outDir: "dist" } as any, {} as any);
}

describe("SSG manifest loading", () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
      tempDirs.delete(dir);
    }
  });

  it("allows a missing manifest before the first production build", () => {
    expect(() => createRenderer()).not.toThrow();
  });

  it("reports malformed JSON instead of silently disabling SSG", () => {
    expect(() => createRenderer("[{")).toThrowError(
      /Failed to parse SSG manifest at .*__ssg_manifest\.json:/,
    );
  });

  it("reports an invalid manifest root", () => {
    expect(() => createRenderer(JSON.stringify({ pages: [] }))).toThrowError(
      /Invalid SSG manifest at .*__ssg_manifest\.json: expected an array of pages/,
    );
  });

  it("reports the index of an invalid manifest entry", () => {
    expect(() =>
      createRenderer(
        JSON.stringify([
          { urlPath: "/valid", params: {} },
          { urlPath: "/invalid", params: { slug: 42 } },
        ]),
      ),
    ).toThrowError(
      /Invalid SSG manifest at .*__ssg_manifest\.json: page 1 must have string params/,
    );
  });

  it("loads the generated manifest shape", () => {
    expect(() =>
      createRenderer(
        JSON.stringify([
          { urlPath: "/about", params: {} },
          { urlPath: "/blog/hello", params: { slug: "hello" }, revalidate: 60 },
        ]),
      ),
    ).not.toThrow();
  });
});

describe("SSG request eligibility", () => {
  it("only serves pre-rendered HTML for production retrieval requests", () => {
    expect(shouldServePrerenderedPage("production", "GET")).toBe(true);
    expect(shouldServePrerenderedPage("production", "head")).toBe(true);
    expect(shouldServePrerenderedPage("production", undefined)).toBe(true);
    expect(shouldServePrerenderedPage("production", "POST")).toBe(false);
    expect(shouldServePrerenderedPage("production", "DELETE")).toBe(false);
    expect(shouldServePrerenderedPage("development", "GET")).toBe(false);
  });
});
