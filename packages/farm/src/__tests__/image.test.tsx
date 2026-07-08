import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Image } from "../image";

describe("Next-compatible Image", () => {
  it("renders a normal img with explicit dimensions", () => {
    const markup = renderToStaticMarkup(
      <Image src="/hero.png" alt="Hero" width={640} height={320} />,
    );

    expect(markup).toContain('src="/hero.png"');
    expect(markup).toContain('alt="Hero"');
    expect(markup).toContain('width="640"');
    expect(markup).toContain('height="320"');
    expect(markup).toContain('loading="lazy"');
  });

  it("maps priority to eager loading and high fetch priority", () => {
    const markup = renderToStaticMarkup(<Image src="/hero.png" alt="Hero" priority />);

    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('fetchPriority="high"');
  });

  it("supports fill layout styles", () => {
    const markup = renderToStaticMarkup(<Image src="/hero.png" alt="Hero" fill objectFit="cover" />);

    expect(markup).not.toContain('width="');
    expect(markup).not.toContain('height="');
    expect(markup).toContain("position:absolute");
    expect(markup).toContain("width:100%");
    expect(markup).toContain("height:100%");
    expect(markup).toContain("object-fit:cover");
  });

  it("supports static image objects and custom loaders", () => {
    const markup = renderToStaticMarkup(
      <Image
        src={{ src: "/hero.png", width: 1200, height: 630 }}
        alt="Hero"
        loader={({ src, width, quality }) => `/cdn${src}?w=${width}&q=${quality}`}
        quality={80}
      />,
    );

    expect(markup).toContain('src="/cdn/hero.png?w=1200&amp;q=80"');
    expect(markup).toContain('width="1200"');
    expect(markup).toContain('height="630"');
  });
});
