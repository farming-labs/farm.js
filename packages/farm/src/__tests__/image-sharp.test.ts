// @vitest-environment node

import { imageSize } from "image-size";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createSharpImageTransformer } from "../image-sharp";

describe("Sharp image adapter", () => {
  it("performs a real format conversion without enlarging the image", async () => {
    const source = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 49, g: 130, b: 83, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const transform = createSharpImageTransformer();
    const result = await transform({
      source,
      sourceUrl: new URL("https://example.test/photo.png"),
      sourceType: "image/png",
      width: 640,
      quality: 75,
      accept: "image/webp",
      formats: ["image/webp"],
      signal: new AbortController().signal,
    });
    const dimensions = imageSize(result.body);

    expect(result.contentType).toBe("image/webp");
    expect(result.body.byteLength).toBeGreaterThan(0);
    expect(dimensions.width).toBe(2);
    expect(dimensions.height).toBe(1);
  });
});
