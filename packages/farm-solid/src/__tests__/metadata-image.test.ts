// @vitest-environment node

import { createRequire } from "node:module";
import * as SolidServer from "../server";

const { createElement } = SolidServer;
import { describe, expect, it } from "vitest";
import {
  createFarmMetadataImageResponse,
  type FarmMetadataImageRenderer,
} from "../../../farm/src/metadata-image";

// React draws the reference image. It's core's dependency, not this package's.
const React = createRequire(new URL("../../../farm/package.json", import.meta.url))("react");

const size = { size: { width: 300, height: 150 } };
const cardStyle = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  background: "#000",
  color: "#fff",
  padding: 12,
};

async function png(value: unknown, renderer?: FarmMetadataImageRenderer): Promise<Buffer> {
  const response = await createFarmMetadataImageResponse(value, size, { renderer });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  return Buffer.from(await response.arrayBuffer());
}

function reactCard(label: string) {
  return React.createElement(
    "div",
    { style: cardStyle },
    React.createElement("span", { style: { fontSize: 32 } }, label),
    React.createElement("span", { className: "text-emerald-400" }, "rows: ", 12),
  );
}

describe("solid metadata images", () => {
  it("renders a Solid element tree to the PNG React draws", async () => {
    const Title = SolidServer.markFunctionComponent
      ? SolidServer.markFunctionComponent((props: { text: string }) =>
          createElement("span", { style: { fontSize: 32 } }, props.text),
        )
      : (props: { text: string }) => createElement("span", { style: { fontSize: 32 } }, props.text);
    const card = createElement(
      "div",
      { style: cardStyle },
      createElement(Title, { text: "Solid" }),
      createElement("span", { className: "text-emerald-400" }, "rows: ", 12),
    );

    expect(await png(card, SolidServer)).toEqual(await png(reactCard("Solid")));
  });
});
