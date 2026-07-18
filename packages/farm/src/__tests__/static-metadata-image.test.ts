// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getStaticMetadataImageAltPath,
  inspectStaticMetadataImage,
  isStaticMetadataImageFile,
} from "../static-metadata-image";

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mNk+M/wHwAF/gL+X5WvWQAAAABJRU5ErkJggg==",
  "base64",
);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("static metadata images", () => {
  it("infers dimensions, content type, alt text, and a stable content hash", async () => {
    const directory = await createTemporaryDirectory();
    const imagePath = path.join(directory, "opengraph-image.png");
    await writeFile(imagePath, PNG_2X1);
    await writeFile(getStaticMetadataImageAltPath(imagePath), "  Product preview  \n");

    const first = await inspectStaticMetadataImage(imagePath);
    const second = await inspectStaticMetadataImage(imagePath);

    expect(first).toMatchObject({
      extension: "png",
      contentType: "image/png",
      width: 2,
      height: 1,
      alt: "Product preview",
      byteLength: PNG_2X1.byteLength,
    });
    expect(first.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(second.hash).toBe(first.hash);
  });

  it("recognizes only supported static metadata image extensions", () => {
    expect(isStaticMetadataImageFile("opengraph-image.png")).toBe(true);
    expect(isStaticMetadataImageFile("twitter-image.WEBP")).toBe(true);
    expect(isStaticMetadataImageFile("opengraph-image.tsx")).toBe(false);
    expect(isStaticMetadataImageFile("opengraph-image.svg")).toBe(false);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "farm-metadata-image-"));
  temporaryDirectories.push(directory);
  return directory;
}
