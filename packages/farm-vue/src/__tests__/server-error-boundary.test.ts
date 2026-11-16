// @vitest-environment node

import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createElement, ErrorBoundary, renderToReadableStream, renderToString } from "../server";

/**
 * Vue's server renderer never renders a boundary again after it captures an error, so a page
 * whose setup threw under Farm's development error boundary came out empty with a 200, and a
 * redirect() or notFound() never reached Farm. The server boundary passes the throw through.
 */
describe("the Vue server ErrorBoundary", () => {
  const thrown = Object.assign(new Error("page threw"), { digest: "FARM_REDIRECT;307;/" });
  const Page = defineComponent({
    name: "Page",
    setup() {
      throw thrown;
    },
  });
  const Fallback = () => h("p", "fallback rendered");
  const element = () =>
    createElement(ErrorBoundary, { Fallback, fallbackProps: {} }, createElement(Page, null));

  it("lets a component's setup error fail renderToString", async () => {
    await expect(renderToString(element())).rejects.toBe(thrown);
  });

  it("lets a component's setup error fail the Web stream", async () => {
    await expect(new Response(renderToReadableStream(element())).text()).rejects.toBe(thrown);
  });

  it("renders its children when nothing throws", async () => {
    const html = await renderToString(
      createElement(ErrorBoundary, { Fallback, fallbackProps: {} }, h("main", "page content")),
    );
    expect(html).toContain("page content");
    expect(html).not.toContain("fallback rendered");
  });
});
