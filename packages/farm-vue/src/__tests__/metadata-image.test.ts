// @vitest-environment node

import { createRequire } from "node:module";
import { defineComponent, h } from "vue";
import * as VueServer from "../server";

const { createElement } = VueServer;
import { describe, expect, it } from "vitest";
import {
  createFarmMetadataImageResponse,
  resolveFarmMetadataImageValue,
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

describe("vue metadata images", () => {
  it("renders a Vue component, as in opengraph-image.vue, to the PNG React draws", async () => {
    const OpenGraphImage = defineComponent({
      props: { path: { type: String, required: true } },
      setup(props) {
        return () =>
          h("div", { style: cardStyle }, [
            h("span", { style: { fontSize: 32 } }, `Vue ${props.path}`),
            h("span", { class: "text-emerald-400" }, ["rows: ", 12]),
          ]);
      },
    });
    const value = await resolveFarmMetadataImageValue(
      { default: OpenGraphImage },
      { params: {}, searchParams: {}, path: "/" },
      { renderer: VueServer, component: true },
    );

    expect(await png(value, VueServer)).toEqual(await png(reactCard("Vue /")));
  });

  it("renders a tree built with Farm's Vue createElement", async () => {
    const Title = VueServer.markFunctionComponent
      ? VueServer.markFunctionComponent((props: { text: string }) =>
          createElement("span", { style: { fontSize: 32 } }, props.text),
        )
      : (props: { text: string }) => createElement("span", { style: { fontSize: 32 } }, props.text);
    const card = createElement(
      "div",
      { style: cardStyle },
      createElement(Title, { text: "Vue" }),
      createElement("span", { className: "text-emerald-400" }, "rows: ", 12),
    );

    expect(await png(card, VueServer)).toEqual(await png(reactCard("Vue")));
  });
});
