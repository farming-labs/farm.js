import { describe, expect, it } from "vitest";
import { createSanityImageLoader } from "./image.js";

const loader = createSanityImageLoader({ projectId: "abc123", dataset: "production" });
const ASSET_ID = "image-Tb9Ew8CXIwaY6R1kjMvI0uRR-2000x3000-jpg";

function params(url: string) {
  return new URL(url).searchParams;
}

describe("createSanityImageLoader", () => {
  it("builds a Sanity CDN URL from an asset id", () => {
    const url = loader({ src: ASSET_ID, width: 800, quality: 75 });

    expect(url.startsWith("https://cdn.sanity.io/images/abc123/production/")).toBe(true);
    expect(url).toContain("Tb9Ew8CXIwaY6R1kjMvI0uRR-2000x3000.jpg");
  });

  it("applies the requested width and quality", () => {
    const url = loader({ src: ASSET_ID, width: 800, quality: 75 });

    expect(params(url).get("w")).toBe("800");
    expect(params(url).get("q")).toBe("75");
  });

  it("lets the CDN pick the format and never upscales", () => {
    const url = loader({ src: ASSET_ID, width: 800, quality: 75 });

    expect(params(url).get("auto")).toBe("format");
    expect(params(url).get("fit")).toBe("max");
  });

  it("accepts a prebuilt CDN URL so crop and hotspot survive", () => {
    // Crop and hotspot live on the image object, which cannot travel through
    // a string `src`. The app builds that base URL itself and the loader only
    // appends the responsive parameters.
    const base =
      "https://cdn.sanity.io/images/abc123/production/Tb9Ew8CXIwaY6R1kjMvI0uRR-2000x3000.jpg?rect=100,200,1500,1500";
    const url = loader({ src: base, width: 400, quality: 60 });

    expect(params(url).get("rect")).toBe("100,200,1500,1500");
    expect(params(url).get("w")).toBe("400");
    expect(params(url).get("q")).toBe("60");
  });

  it("keeps the fit mode of a prebuilt URL", () => {
    const base =
      "https://cdn.sanity.io/images/abc123/production/Tb9Ew8CXIwaY6R1kjMvI0uRR-2000x3000.jpg?fit=crop&crop=focalpoint";
    const url = loader({ src: base, width: 400, quality: 60 });

    expect(params(url).get("fit")).toBe("crop");
    expect(params(url).get("crop")).toBe("focalpoint");
  });

  it("produces distinct URLs per width for a srcset", () => {
    const small = loader({ src: ASSET_ID, width: 400, quality: 75 });
    const large = loader({ src: ASSET_ID, width: 1600, quality: 75 });

    expect(small).not.toBe(large);
    expect(params(small).get("w")).toBe("400");
    expect(params(large).get("w")).toBe("1600");
  });

  it("uses integer dimensions even if a fractional width is requested", () => {
    // The Sanity CDN can time out on non-integer values.
    const url = loader({ src: ASSET_ID, width: 333.7, quality: 75 });

    expect(params(url).get("w")).toBe("334");
  });
});
