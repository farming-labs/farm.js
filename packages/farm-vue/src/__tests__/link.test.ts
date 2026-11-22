// @vitest-environment jsdom

import { setFarmBasePath } from "@farm.js/core/internal/client-runtime";
import { renderToString } from "@vue/server-renderer";
import { createApp, createSSRApp, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link } from "../bindings";

/** Vue writes an empty attribute bare (`data-farm-link`), so the tests read the parsed anchor. */
function parseAnchor(html: string): HTMLAnchorElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  expect(template.content.childNodes).toHaveLength(1);
  return template.content.firstChild as HTMLAnchorElement;
}

function attributesOf(anchor: Element): Record<string, string> {
  return Object.fromEntries(Array.from(anchor.attributes, (attr) => [attr.name, attr.value]));
}

afterEach(() => {
  setFarmBasePath("/");
  document.body.replaceChildren();
});

describe("Vue Link", () => {
  it("renders the anchor the router navigates and prefetches", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            Link,
            {
              href: "/crops/[name]",
              params: { name: "winter wheat" },
              query: new URLSearchParams({ sort: "rows" }),
              prefetch: "intent",
              prefetchDelay: 120,
              replace: true,
              scroll: false,
              viewTransition: "auto",
              class: "nav",
            },
            () => "Wheat",
          ),
      }),
    );

    const anchor = parseAnchor(html);
    expect(attributesOf(anchor)).toEqual({
      class: "nav",
      href: "/crops/winter%20wheat?sort=rows",
      "data-farm-link": "",
      "data-farm-prefetch": "intent",
      "data-farm-prefetch-delay": "120",
      "data-replace": "",
      "data-no-scroll": "",
      "data-view-transition": "auto",
    });
    expect(anchor.textContent).toBe("Wheat");
  });

  it("keeps the defaults of the React Link for absent boolean props", async () => {
    setFarmBasePath("/farm");
    const html = await renderToString(
      createSSRApp({ render: () => h(Link, { href: "/about" }, () => "About") }),
    );

    expect(attributesOf(parseAnchor(html))).toEqual({ href: "/farm/about", "data-farm-link": "" });
  });

  it("reads a bare boolean attribute as true, as in a template", async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(Link, { href: "/about", replace: "", prefetch: "" }) }),
    );

    expect(attributesOf(parseAnchor(html))).toEqual({
      href: "/about",
      "data-farm-link": "",
      "data-replace": "",
    });
  });

  it("renders a javascript: URL without an href", async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(Link, { href: "javascript:alert(1)" }, () => "Nope") }),
    );

    const anchor = parseAnchor(html);
    expect(attributesOf(anchor)).toEqual({ "data-farm-link": "" });
    expect(anchor.textContent).toBe("Nope");
  });

  it("updates its anchor and keeps listeners in the browser", async () => {
    const name = ref("wheat");
    const onClick = vi.fn((event: Event) => event.preventDefault());
    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp({
      render: () =>
        h(Link, { href: "/crops/[name]", params: { name: name.value }, onClick }, () => name.value),
    });
    app.mount(container);

    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("/crops/wheat");
    anchor.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    name.value = "barley";
    await nextTick();
    expect(container.querySelector("a")).toBe(anchor);
    expect(anchor.getAttribute("href")).toBe("/crops/barley");
    expect(anchor.textContent).toBe("barley");
    app.unmount();
  });
});
