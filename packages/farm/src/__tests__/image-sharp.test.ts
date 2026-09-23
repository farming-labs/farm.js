// @vitest-environment node

import { imageSize } from "image-size";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createNodeImageFetcher, createSharpImageTransformer } from "../image-sharp";
import { resolveFarmImageConfig } from "../image-config";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  request: requestMock,
}));

describe("Sharp image adapter", () => {
  it("rejects invalid upstream status codes without constructing a Response", async () => {
    const resume = vi.fn();
    requestMock.mockImplementationOnce((_url, _options, onResponse) => {
      return {
        once: vi.fn(),
        end() {
          onResponse({ statusCode: 700, resume });
        },
      };
    });
    const fetchRemote = createNodeImageFetcher(
      resolveFarmImageConfig({
        remotePatterns: [{ protocol: "http", hostname: "images.example.test" }],
      }),
      (_hostname, _options, callback) => {
        callback(null, [{ address: "203.0.113.1", family: 4 }]);
      },
    );

    await expect(fetchRemote("http://images.example.test/photo.png")).rejects.toThrow(
      "invalid HTTP status",
    );
    expect(resume).toHaveBeenCalledOnce();
  });

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

  it("keeps the source format when the Accept header matches nothing", async () => {
    const source = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 49, g: 130, b: 83, alpha: 0.5 },
      },
    })
      .webp()
      .toBuffer();
    const transform = createSharpImageTransformer();

    // curl / fetch() default Accept matches none of the configured formats.
    const result = await transform({
      source,
      sourceUrl: new URL("https://example.test/photo.webp"),
      sourceType: "image/webp",
      width: 640,
      quality: 75,
      accept: "*/*",
      formats: ["image/avif"],
      signal: new AbortController().signal,
    });

    // The body must be what the content type claims: previously this was
    // JPEG bytes served as image/webp (with nosniff), and transparency died.
    expect(result.contentType).toBe("image/webp");
    const metadata = await sharp(result.body).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.hasAlpha).toBe(true);
  });

  it("rasterizes svg sources to png with a matching content type", async () => {
    const source = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><rect width="2" height="1" fill="#318253" fill-opacity="0.5"/></svg>',
    );
    const transform = createSharpImageTransformer();

    const result = await transform({
      source,
      sourceUrl: new URL("https://example.test/logo.svg"),
      sourceType: "image/svg+xml",
      width: 640,
      quality: 75,
      accept: "*/*",
      formats: ["image/avif"],
      signal: new AbortController().signal,
    });

    expect(result.contentType).toBe("image/png");
    const metadata = await sharp(result.body).metadata();
    expect(metadata.format).toBe("png");
  });
});
