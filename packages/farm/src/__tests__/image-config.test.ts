import { describe, expect, it } from "vitest";
import { DEFAULT_FARM_IMAGE_PATH, resolveFarmImageConfig } from "../image-config";

describe("image config", () => {
  it("resolves secure optimizer defaults", () => {
    const config = resolveFarmImageConfig(undefined);

    expect(config).toMatchObject({
      provider: "auto",
      path: DEFAULT_FARM_IMAGE_PATH,
      qualities: [75],
      formats: ["image/webp"],
      minimumCacheTTL: 60,
      maximumResponseBody: 10_000_000,
      maximumRedirects: 3,
      dangerouslyAllowSVG: false,
      dangerouslyAllowLocalIP: false,
    });
    expect(config.domains).toEqual([]);
    expect(config.remotePatterns).toEqual([]);
    expect(config.localPatterns).toEqual([{ pathname: "/**" }]);
  });

  it("normalizes sorted allowlists and byte sizes", () => {
    const config = resolveFarmImageConfig({
      path: "/media/optimize/",
      deviceSizes: [1280, 640, 1280],
      imageSizes: [64, 32],
      qualities: [90, 70, 90],
      formats: ["image/avif", "image/webp", "image/avif"],
      domains: ["CDN.EXAMPLE.COM", "cdn.example.com"],
      remotePatterns: [
        {
          protocol: "https",
          hostname: "IMAGES.EXAMPLE.COM",
          pathname: "/products/**",
        },
      ],
      maximumResponseBody: "2 MiB",
    });

    expect(config.path).toBe("/media/optimize");
    expect(config.deviceSizes).toEqual([640, 1280]);
    expect(config.imageSizes).toEqual([32, 64]);
    expect(config.qualities).toEqual([70, 90]);
    expect(config.formats).toEqual(["image/avif", "image/webp"]);
    expect(config.domains).toEqual(["cdn.example.com"]);
    expect(config.remotePatterns[0]?.hostname).toBe("images.example.com");
    expect(config.maximumResponseBody).toBe(2_097_152);
  });

  it("rejects unsafe or unusable config", () => {
    expect(() => resolveFarmImageConfig({ path: "images" })).toThrow("absolute pathname");
    expect(() => resolveFarmImageConfig({ qualities: [0, 101] })).toThrow("no greater than 100");
    expect(() => resolveFarmImageConfig({ deviceSizes: [] })).toThrow("must contain at least one");
    expect(() =>
      resolveFarmImageConfig({
        remotePatterns: [{ hostname: "example.com/path" }],
      }),
    ).toThrow("hostname");
    expect(() => resolveFarmImageConfig({ maximumResponseBody: "many" })).toThrow("size string");
  });
});
