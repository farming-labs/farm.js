import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Image, { getImageProps, type StaticImageData } from "../image";

const staticImage: StaticImageData = {
  src: "/assets/product-a1b2.png",
  width: 800,
  height: 600,
  blurDataURL: "data:image/webp;base64,cGxhY2Vob2xkZXI=",
};

describe("Image", () => {
  it("uses dimensions and blur metadata from a static import", () => {
    const html = renderToStaticMarkup(
      <Image src={staticImage} alt="Red Farm jacket" placeholder="blur" />,
    );

    expect(html).toContain('alt="Red Farm jacket"');
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("/_farm/image?url=%2Fassets%2Fproduct-a1b2.png");
    expect(html).toContain("1x");
    expect(html).toContain("2x");
    expect(html).toContain("background-image:url(&quot;data:image/webp;base64");
  });

  it("generates width descriptors for responsive and fill images", () => {
    const { props } = getImageProps({
      src: "/hero.jpg",
      alt: "Farm field",
      fill: true,
      sizes: "(max-width: 768px) 100vw, 50vw",
    });

    expect(props.sizes).toBe("(max-width: 768px) 100vw, 50vw");
    expect(props.srcSet).toContain("384w");
    expect(props.srcSet).toContain("3840w");
    expect(props.width).toBeUndefined();
    expect(props.height).toBeUndefined();
    expect(props.style).toMatchObject({
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
    });
  });

  it("supports custom loaders and preload priority", () => {
    const { props } = getImageProps({
      src: "https://images.example.com/product.jpg",
      alt: "Product",
      width: 400,
      height: 300,
      quality: 90,
      preload: true,
      loader: ({ src, width, quality }) =>
        `https://cdn.example.com/${width}/${quality}?src=${encodeURIComponent(src)}`,
    });

    expect(props.src).toContain("https://cdn.example.com/828/75");
    expect(props.srcSet).toContain("https://cdn.example.com/640/75");
    expect(props.fetchPriority).toBe("high");
    expect(props.loading).toBe("eager");
  });

  it("leaves data and SVG sources unoptimized", () => {
    const svg = getImageProps({
      src: "/logo.svg",
      alt: "Farm",
      width: 120,
      height: 40,
    });
    const data = getImageProps({
      src: "data:image/png;base64,AA==",
      alt: "Pixel",
      width: 1,
      height: 1,
    });

    expect(svg.props.src).toBe("/logo.svg");
    expect(svg.props.srcSet).toBeUndefined();
    expect(data.props.src).toBe("data:image/png;base64,AA==");
    expect(data.props.srcSet).toBeUndefined();
  });

  it("requires dimensions and explicit blur metadata", () => {
    expect(() => getImageProps({ src: "/photo.jpg", alt: "Photo" })).toThrow(
      "requires width and height",
    );
    expect(() =>
      getImageProps({
        src: "/photo.jpg",
        alt: "Photo",
        width: 800,
        height: 600,
        placeholder: "blur",
      }),
    ).toThrow("requires a static import or blurDataURL");
  });
});
