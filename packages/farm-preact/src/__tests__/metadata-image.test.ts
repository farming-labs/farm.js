// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createFarmMetadataImageResponse } from "../../../farm/src/metadata-image";
import * as PreactServer from "../server";

const { createElement } = PreactServer;

// An `opengraph-image.tsx` default export, compiled with Preact's JSX.
function Card({ title }: { title: string }) {
  return createElement(
    "div",
    { style: { display: "flex", width: "100%", height: "100%", background: "black" } },
    createElement("span", { style: { color: "white", fontSize: 48 } }, title),
  );
}

describe("preact metadata images", () => {
  it("renders a Preact element to a PNG with the app renderer", async () => {
    const response = await createFarmMetadataImageResponse(
      createElement(Card, { title: "Farm.js" }),
      { size: { width: 120, height: 63 } },
      { renderer: PreactServer },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("renders an explicit SVG image with the Preact server renderer", async () => {
    const response = await createFarmMetadataImageResponse(
      createElement(
        "svg",
        { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 10 10" },
        createElement("text", null, "Farm"),
      ),
      { contentType: "image/svg+xml" },
      { renderer: PreactServer },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Farm</text></svg>',
    );
  });
});
