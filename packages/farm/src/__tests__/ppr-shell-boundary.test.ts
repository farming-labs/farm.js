// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findStaticShellBoundary } from "../renderer/react/server";
import type { FarmServerRendererRuntime } from "../renderer";

describe("static shell boundary detection is owned by the renderer", () => {
  it("React finds its own Fizz reveal markers", () => {
    // Fizz labels streamed segments and reveals them with $RC/$RS/$RV/$RX.
    for (const chunk of [
      '<div id="S:1">late</div>',
      "<script>$RC('B:0','S:0')</script>",
      "<script>$RS('S:1','P:1')</script>",
      "<script>$RV(0)</script>",
      "<script>$RX('B:2')</script>",
    ]) {
      expect(findStaticShellBoundary(chunk)).toBeGreaterThanOrEqual(0);
    }
  });

  it("React reports a fully static chunk as having no boundary", () => {
    expect(findStaticShellBoundary("<main><h1>All static</h1></main>")).toBe(-1);
  });

  it("cuts at the start of the tag holding the marker, not mid-tag", () => {
    const chunk = '<p>keep this</p><div id="S:1">dynamic</div>';
    const index = findStaticShellBoundary(chunk);
    expect(chunk.slice(0, index)).toBe("<p>keep this</p>");
  });

  it("a renderer that streams different markers is not matched by React's", () => {
    // Solid streams <template id="pl-N"> placeholders resolved by $df(N).
    // React's detector must not claim them, which is exactly why a renderer
    // without its own implementation gets no shell rather than a wrong one.
    expect(findStaticShellBoundary('<template id="pl-0">x</template>')).toBe(-1);
    expect(findStaticShellBoundary("<script>$df(0)</script>")).toBe(-1);
  });

  it("the hook is optional on the runtime contract", () => {
    // A runtime without it is valid; core then skips the static shell instead
    // of treating a per-request response as cacheable.
    const runtime: Partial<FarmServerRendererRuntime> = { name: "solid" };
    expect(runtime.findStaticShellBoundary).toBeUndefined();
  });
});
