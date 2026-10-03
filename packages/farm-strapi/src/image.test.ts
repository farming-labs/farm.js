import { describe, expect, it } from "vitest";
import { getStrapiImageProps, type StrapiMediaAsset } from "./image.js";

const asset: StrapiMediaAsset = {
  url: "/uploads/cover.jpg",
  width: 1600,
  height: 900,
  alternativeText: "Farm field",
  formats: {
    thumbnail: { url: "/uploads/thumbnail_cover.jpg", width: 245, height: 138 },
    small: { url: "/uploads/small_cover.jpg", width: 500, height: 281 },
    medium: { url: "https://cdn.example.com/medium_cover.jpg", width: 750, height: 422 },
  },
};

describe("getStrapiImageProps", () => {
  it("selects the closest generated size at least as wide as requested", () => {
    const props = getStrapiImageProps(asset, {
      mediaUrl: "https://media.example.com",
      width: 600,
    });

    expect(props.src).toBe("https://cdn.example.com/medium_cover.jpg");
    expect(props.width).toBe(600);
    expect(props.height).toBe(338);
  });

  it("uses the largest candidate instead of upscaling when none is wide enough", () => {
    const props = getStrapiImageProps(asset, {
      mediaUrl: "https://media.example.com",
      width: 2400,
    });

    expect(props.src).toBe("https://media.example.com/uploads/cover.jpg");
  });

  it("builds a srcset from each real generated width", () => {
    const props = getStrapiImageProps(asset, { mediaUrl: "https://media.example.com" });

    expect(props.srcSet).toContain("thumbnail_cover.jpg 245w");
    expect(props.srcSet).toContain("small_cover.jpg 500w");
    expect(props.srcSet).toContain("medium_cover.jpg 750w");
    expect(props.srcSet).toContain("cover.jpg 1600w");
  });

  it("preserves absolute provider URLs and resolves relative ones against the media origin", () => {
    const props = getStrapiImageProps(asset, { mediaUrl: "https://media.example.com/assets" });

    expect(props.srcSet).toContain("https://cdn.example.com/medium_cover.jpg");
    expect(props.srcSet).toContain("https://media.example.com/uploads/small_cover.jpg");
  });

  it("uses asset accessibility metadata and native loading defaults", () => {
    const props = getStrapiImageProps(asset, {
      mediaUrl: "https://media.example.com",
      sizes: "(max-width: 700px) 100vw, 700px",
    });

    expect(props.alt).toBe("Farm field");
    expect(props.loading).toBe("lazy");
    expect(props.decoding).toBe("async");
    expect(props.sizes).toBe("(max-width: 700px) 100vw, 700px");
  });

  it("requires a media origin for relative assets", () => {
    expect(() => getStrapiImageProps(asset)).toThrow(/media URL/);
  });

  it("rejects non-http asset URLs", () => {
    expect(() =>
      getStrapiImageProps(
        { ...asset, url: "javascript:alert(1)", formats: null },
        { mediaUrl: "https://media.example.com" },
      ),
    ).toThrow(/HTTP or HTTPS/);
  });

  it("rejects invalid original dimensions before calculating an aspect ratio", () => {
    expect(() =>
      getStrapiImageProps(
        { ...asset, width: 0 },
        { mediaUrl: "https://media.example.com", width: 600 },
      ),
    ).toThrow(/dimensions/);
  });
});
