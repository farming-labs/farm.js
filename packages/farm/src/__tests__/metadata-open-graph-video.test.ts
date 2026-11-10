/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import { renderMetadataHead } from "../metadata";

const headLines = (metadata: Parameters<typeof renderMetadataHead>[0]) =>
  renderMetadataHead(metadata)
    .tags.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

afterEach(() => {
  document.head.innerHTML = "";
});

describe("open graph videos", () => {
  it("renders og:video tags with URLs resolved against metadataBase", () => {
    const tags = headLines({
      metadataBase: "https://farm.test",
      openGraph: {
        type: "video.other",
        images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
        videos: [
          {
            url: "/og/home.mp4",
            secureUrl: "/og/home.mp4",
            type: "video/mp4",
            width: 2400,
            height: 1260,
          },
        ],
      },
    });

    const video = [
      '<meta property="og:video" content="https://farm.test/og/home.mp4">',
      '<meta property="og:video:secure_url" content="https://farm.test/og/home.mp4">',
      '<meta property="og:video:type" content="video/mp4">',
      '<meta property="og:video:width" content="2400">',
      '<meta property="og:video:height" content="1260">',
    ];
    const start = tags.indexOf(video[0]!);
    expect(start).toBeGreaterThan(tags.indexOf('<meta property="og:image:height" content="630">'));
    expect(tags.slice(start, start + video.length)).toEqual(video);
    expect(tags).toContain('<meta property="og:type" content="video.other">');
  });

  it("accepts a URL string and a list of videos", () => {
    expect(
      headLines({ metadataBase: "https://farm.test", openGraph: { videos: "/a.mp4" } }),
    ).toContain('<meta property="og:video" content="https://farm.test/a.mp4">');

    const tags = headLines({
      openGraph: {
        videos: [{ url: "https://cdn.test/a.mp4" }, { url: "https://cdn.test/b.webm" }],
      },
    });
    expect(tags.filter((tag) => tag.startsWith('<meta property="og:video"'))).toEqual([
      '<meta property="og:video" content="https://cdn.test/a.mp4">',
      '<meta property="og:video" content="https://cdn.test/b.webm">',
    ]);
  });

  it("drops entries without a URL and escapes values", () => {
    const tags = headLines({
      openGraph: {
        videos: [{ url: "" }, { url: "https://cdn.test/a.mp4", type: '"><script>' }],
      },
    });

    expect(tags.filter((tag) => tag.startsWith('<meta property="og:video"'))).toHaveLength(1);
    expect(tags.join("\n")).not.toContain("<script");
    expect(tags).toContain('<meta property="og:video:type" content="&quot;&gt;&lt;script&gt;">');
  });

  it("removes a page's video when client navigation reaches a page without one", () => {
    applyFarmMetadataToDocument(
      { openGraph: { videos: [{ url: "https://cdn.test/home.mp4", type: "video/mp4" }] } },
      "/",
    );
    expect(document.head.querySelector('meta[property="og:video"]')?.getAttribute("content")).toBe(
      "https://cdn.test/home.mp4",
    );

    applyFarmMetadataToDocument({ openGraph: { title: "Docs" } }, "/docs");
    expect(document.head.querySelector('meta[property^="og:video"]')).toBeNull();
  });
});
