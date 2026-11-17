/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import { addMetadataImageReference, renderMetadataHead } from "../metadata";
import { FARM_VIDEO_PLAYER_HTML } from "../video-player";

const headLines = (metadata: Parameters<typeof renderMetadataHead>[0]) =>
  renderMetadataHead(metadata)
    .tags.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const twitterLines = (metadata: Parameters<typeof renderMetadataHead>[0]) =>
  headLines(metadata).filter((tag) => tag.startsWith('<meta name="twitter:'));

afterEach(() => {
  document.head.innerHTML = "";
});

describe("twitter player cards", () => {
  it("renders twitter:player tags with URLs resolved against metadataBase", () => {
    expect(
      twitterLines({
        metadataBase: "https://farm.test",
        twitter: {
          card: "player",
          site: "@farm",
          title: "Farm",
          images: ["/opengraph-image"],
          players: [
            {
              playerUrl: "/videos/home.html",
              streamUrl: "/videos/home.mp4",
              width: 1200,
              height: 630,
            },
          ],
        },
      }),
    ).toEqual([
      '<meta name="twitter:card" content="player">',
      '<meta name="twitter:site" content="@farm">',
      '<meta name="twitter:title" content="Farm">',
      '<meta name="twitter:image" content="https://farm.test/opengraph-image">',
      '<meta name="twitter:player" content="https://farm.test/videos/home.html">',
      '<meta name="twitter:player:stream" content="https://farm.test/videos/home.mp4">',
      '<meta name="twitter:player:width" content="1200">',
      '<meta name="twitter:player:height" content="630">',
    ]);
  });

  it("defaults the card to player when players are set", () => {
    const tags = twitterLines({
      twitter: { players: { playerUrl: "https://cdn.test/player", width: 640, height: 360 } },
    });

    expect(tags[0]).toBe('<meta name="twitter:card" content="player">');
    expect(tags).toContain('<meta name="twitter:player" content="https://cdn.test/player">');
    expect(tags.some((tag) => tag.includes("twitter:player:stream"))).toBe(false);
  });

  it("keeps an explicit card", () => {
    expect(
      twitterLines({
        twitter: {
          card: "summary_large_image",
          players: { playerUrl: "https://cdn.test/player", width: 640, height: 360 },
        },
      })[0],
    ).toBe('<meta name="twitter:card" content="summary_large_image">');
  });

  it("keeps the player card when a twitter-image file supplies the image", () => {
    const metadata = addMetadataImageReference(
      { twitter: { players: { playerUrl: "https://cdn.test/player", width: 640, height: 360 } } },
      { kind: "twitter", href: "/twitter-image" },
    );

    const tags = twitterLines(metadata);
    expect(tags[0]).toBe('<meta name="twitter:card" content="player">');
    expect(tags).toContain('<meta name="twitter:image" content="/twitter-image">');
  });

  it("drops entries without a player URL and escapes values", () => {
    const tags = twitterLines({
      twitter: {
        players: [
          { playerUrl: "", width: 1, height: 1 },
          { playerUrl: 'https://cdn.test/p?a="><script>', width: 640, height: 360 },
        ],
      },
    });

    expect(tags.filter((tag) => tag.startsWith('<meta name="twitter:player"'))).toEqual([
      '<meta name="twitter:player" content="https://cdn.test/p?a=&quot;&gt;&lt;script&gt;">',
    ]);
    expect(tags.join("\n")).not.toContain("<script");
  });

  it("does not turn a card without usable players into a player card", () => {
    expect(
      twitterLines({
        twitter: { title: "Farm", players: [{ playerUrl: "", width: 1, height: 1 }] },
      }),
    ).toEqual(['<meta name="twitter:title" content="Farm">']);
  });

  it("removes a page's player when client navigation reaches a page without one", () => {
    applyFarmMetadataToDocument(
      { twitter: { players: { playerUrl: "https://cdn.test/player", width: 640, height: 360 } } },
      "/",
    );
    expect(
      document.head.querySelector('meta[name="twitter:player"]')?.getAttribute("content"),
    ).toBe("https://cdn.test/player");

    applyFarmMetadataToDocument({ twitter: { title: "Docs" } }, "/docs");
    expect(document.head.querySelector('meta[name^="twitter:player"]')).toBeNull();
    expect(document.head.querySelector('meta[name="twitter:card"]')).toBeNull();
  });
});

describe("automatic player cards from openGraph.videos", () => {
  const home = {
    metadataBase: "https://farm.test",
    openGraph: {
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
      videos: [{ url: "/og/home.mp4", type: "video/mp4", width: 2400, height: 1260 }],
    },
  };

  it("plays a same-origin video in Farm's player page", () => {
    expect(twitterLines(home)).toEqual([
      '<meta name="twitter:card" content="player">',
      '<meta name="twitter:player" content="https://farm.test/_farm/video-player.html?src=%2Fog%2Fhome.mp4&amp;poster=%2Fopengraph-image">',
      '<meta name="twitter:player:width" content="2400">',
      '<meta name="twitter:player:height" content="1260">',
    ]);
  });

  it("keeps the page's twitter fields and an explicit player card", () => {
    const tags = twitterLines({ ...home, twitter: { card: "player", site: "@farm" } });
    expect(tags.slice(0, 2)).toEqual([
      '<meta name="twitter:card" content="player">',
      '<meta name="twitter:site" content="@farm">',
    ]);
    expect(tags.filter((tag) => tag.startsWith('<meta name="twitter:player"'))).toHaveLength(1);
  });

  it("leaves another card type and players: [] alone", () => {
    expect(twitterLines({ ...home, twitter: { card: "summary_large_image" } })).toEqual([
      '<meta name="twitter:card" content="summary_large_image">',
    ]);
    expect(twitterLines({ ...home, twitter: { players: [] } })).toEqual([]);
  });

  it("prefers the page's own players", () => {
    const tags = twitterLines({
      ...home,
      twitter: { players: { playerUrl: "https://cdn.test/player", width: 640, height: 360 } },
    });
    expect(tags).toContain('<meta name="twitter:player" content="https://cdn.test/player">');
    expect(tags.join("\n")).not.toContain("video-player.html");
  });

  it("skips videos on another origin, player pages, and unsafe paths", () => {
    for (const videos of [
      [{ url: "https://cdn.test/home.mp4" }],
      [{ url: "https://farm.test/embed", type: "text/html" }],
      [{ url: "//evil.test/home.mp4" }],
      [{ url: "/\\evil.test/home.mp4" }],
    ]) {
      expect(twitterLines({ metadataBase: "https://farm.test", openGraph: { videos } })).toEqual(
        [],
      );
    }
  });

  it("uses the first playable video and a 1200x630 player when it has no size", () => {
    expect(
      twitterLines({
        metadataBase: "https://farm.test/",
        openGraph: {
          videos: [{ url: "https://farm.test/embed", type: "text/html" }, { url: "/b.webm" }],
        },
      }),
    ).toEqual([
      '<meta name="twitter:card" content="player">',
      '<meta name="twitter:player" content="https://farm.test/_farm/video-player.html?src=%2Fb.webm">',
      '<meta name="twitter:player:width" content="1200">',
      '<meta name="twitter:player:height" content="630">',
    ]);
  });

  it("accepts only root-relative videos without a metadataBase", () => {
    expect(twitterLines({ openGraph: { videos: "/a.mp4" } })).toContain(
      '<meta name="twitter:player" content="/_farm/video-player.html?src=%2Fa.mp4">',
    );
    expect(twitterLines({ openGraph: { videos: "a.mp4" } })).toEqual([]);
    expect(twitterLines({ openGraph: { videos: "https://farm.test/a.mp4" } })).toEqual([]);
  });

  it("keeps the player card when a twitter-image file supplies the image", () => {
    const tags = twitterLines(addMetadataImageReference(home, { kind: "twitter", href: "/ti" }));
    expect(tags[0]).toBe('<meta name="twitter:card" content="player">');
    expect(tags).toContain('<meta name="twitter:image" content="https://farm.test/ti">');
  });

  it("removes the player when client navigation reaches a page without a video", () => {
    applyFarmMetadataToDocument(home, "/");
    expect(document.head.querySelector('meta[name="twitter:player"]')).not.toBeNull();

    applyFarmMetadataToDocument({ metadataBase: "https://farm.test" }, "/docs");
    expect(document.head.querySelector('meta[name^="twitter:"]')).toBeNull();
  });
});

describe("Farm's video player page", () => {
  async function loadPlayer(search: string) {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(FARM_VIDEO_PLAYER_HTML, {
      url: `https://farm.test/_farm/video-player.html${search}`,
      runScripts: "dangerously",
    });
    return dom.window.document.querySelector("video")!;
  }

  it("plays a same-origin video with its poster", async () => {
    const video = await loadPlayer("?src=%2Fog%2Fhome.mp4&poster=%2Fopengraph-image");
    expect(video.src).toBe("https://farm.test/og/home.mp4");
    expect(video.poster).toBe("https://farm.test/opengraph-image");
    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.controls).toBe(true);
  });

  it("refuses URLs on another origin", async () => {
    for (const src of ["https://evil.test/a.mp4", "//evil.test/a.mp4", "javascript:alert(1)"]) {
      const video = await loadPlayer(`?src=${encodeURIComponent(src)}&poster=%2Fa.png`);
      expect(video.getAttribute("src")).toBeNull();
      expect(video.getAttribute("poster")).toBeNull();
    }
  });
});
