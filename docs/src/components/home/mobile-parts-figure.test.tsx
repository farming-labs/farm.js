// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobilePartsFigure } from "./mobile-parts-figure";

describe("mobile parts figure", () => {
  it("sends a sized, described frame and leaves the drawing to the browser", () => {
    const html = renderToStaticMarkup(<MobilePartsFigure />);
    expect(html).toMatch(/viewBox="-178 -96 380 268"/);
    // Readers without the drawing still get every part and how they connect.
    for (const part of ["native frame", "navigator", "screens", "__farmBridge", "your Farm app"])
      expect(html).toContain(part);
    expect(html).toContain("a tap travels from the native frame to your server and back");
    // The scene's polygons arrive with hydration, not in the homepage HTML.
    expect(html).not.toContain("<polygon");
    expect(html.length).toBeLessThan(3000);
  });
});
