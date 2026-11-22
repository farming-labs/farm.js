// @vitest-environment node

import { setFarmBasePath } from "@farm.js/core/internal/client-runtime";
import { createComponent, renderToString } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { Link } from "../bindings";

afterEach(() => setFarmBasePath("/"));

describe("Solid Link", () => {
  it("renders the anchor the router navigates and prefetches", () => {
    const html = renderToString(() =>
      createComponent(Link, {
        href: "/crops/[name]",
        params: { name: "winter wheat" },
        query: { sort: "rows" },
        prefetch: "intent",
        prefetchDelay: 120,
        replace: true,
        scroll: false,
        viewTransition: true,
        class: "nav",
        children: "Wheat",
      }),
    );

    expect(html).toContain('href="/crops/winter%20wheat?sort=rows"');
    // Solid's own spread serializer writes `class="nav "`, for a plain `<Dynamic component="a">` too.
    expect(html).toMatch(/ class="nav\s*"/);
    expect(html).toContain('data-farm-link=""');
    expect(html).toContain('data-farm-prefetch="intent"');
    expect(html).toContain('data-farm-prefetch-delay="120"');
    expect(html).toContain('data-replace=""');
    expect(html).toContain('data-no-scroll=""');
    expect(html).toContain('data-view-transition="true"');
    expect(html).toContain(">Wheat</a>");
    for (const option of ["params", "query", "prefetch=", "replace=", "scroll", "viewtransition"]) {
      expect(html.toLowerCase()).not.toContain(` ${option}`);
    }
  });

  it("prefixes the app base path and writes nothing for the default prefetch", () => {
    setFarmBasePath("/farm");
    const html = renderToString(() => createComponent(Link, { href: "/about", children: "About" }));

    expect(html).toContain('href="/farm/about"');
    expect(html).not.toContain("data-farm-prefetch");
    expect(html).not.toContain("data-replace");
  });

  it("renders a javascript: URL without an href", () => {
    const html = renderToString(() =>
      createComponent(Link, { href: "javascript:alert(1)", children: "Nope" }),
    );

    expect(html).not.toContain("href=");
    expect(html).toContain(">Nope</a>");
  });
});
