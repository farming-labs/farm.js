// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import { FARM_LAYOUT_ELEMENT_CLIENT_SOURCE } from "../../../farm/src/document-layout-client";
import VueClient, { hydrateRoot } from "../client";
import VueServer, { renderToString } from "../server";

// Evaluate the shared client source the way the generated entries do, with the
// renderer's compat runtime in scope as `React`.
function loadCreateLayoutElement() {
  return new Function(
    "React",
    `${FARM_LAYOUT_ELEMENT_CLIENT_SOURCE}\nreturn createFarmLayoutElement;`,
  )(VueClient);
}

const Layout = defineComponent({
  props: ["params"],
  setup(_, { slots }) {
    const count = ref(0);
    return () => [
      h("header", [
        h("button", { id: "layout", onClick: () => count.value++ }, `layout ${count.value}`),
      ]),
      h("main", slots.default?.()),
    ];
  },
});

const Page = defineComponent({
  setup() {
    const count = ref(0);
    return () => h("button", { id: "page", onClick: () => count.value++ }, `page ${count.value}`);
  },
});

const pageBoundaryProps = {
  id: "__farm_page__",
  "data-farm-segment": "page",
  "data-farm-client": "true",
  "data-farm-layout-client": "true",
  "data-farm-island": "page",
  "data-farm-island-strategy": "load",
};

describe("vue layout hydration", () => {
  it("keeps the server markup of a hydrated layout that renders its children", async () => {
    // The tree the server renderer builds for a page under a hydrated layout.
    const html = await renderToString(
      VueServer.createElement(
        "div",
        {
          "data-farm-layout-boundary": "true",
          "data-farm-layout-pattern": "/",
          style: { display: "contents" },
        },
        VueServer.createElement(Layout, {
          children: VueServer.createElement(
            "div",
            pageBoundaryProps,
            VueServer.createElement(Page, {}),
          ),
          params: {},
        }),
      ),
    );

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const serverHeader = container.querySelector("header");
    expect(serverHeader).toBeTruthy();

    const createFarmLayoutElement = loadCreateLayoutElement();
    hydrateRoot(
      container,
      createFarmLayoutElement(
        Layout,
        "/",
        VueClient.createElement("div", pageBoundaryProps, VueClient.createElement(Page, {})),
        {},
      ),
    );
    await nextTick();

    expect(container.querySelector("header")).toBe(serverHeader);
    (container.querySelector("#layout") as HTMLButtonElement).click();
    (container.querySelector("#page") as HTMLButtonElement).click();
    await nextTick();
    expect(container.querySelector("#layout")?.textContent).toBe("layout 1");
    expect(container.querySelector("#page")?.textContent).toBe("page 1");

    container.remove();
  });
});
