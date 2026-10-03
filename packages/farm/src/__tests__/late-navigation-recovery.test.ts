import { describe, expect, it } from "vitest";
import {
  createLateNotFoundRecovery,
  createLateRedirectRecovery,
  isLateRedirectTarget,
} from "../navigation/late-navigation-recovery";

describe("late navigation recovery", () => {
  it("redirects in the browser only to http(s) targets", () => {
    for (const target of [
      "/sign-in",
      "dashboard?tab=1",
      "//cdn.example.com/x",
      "https://example.com",
    ]) {
      expect(isLateRedirectTarget(target)).toBe(true);
    }
    for (const target of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      expect(isLateRedirectTarget(target)).toBe(false);
      expect(createLateRedirectRecovery(target)).toBe("");
    }
  });

  it("escapes the target so it cannot close the script", () => {
    const html = createLateRedirectRecovery("/x</script><script>alert(1)</script>");
    expect(html).toBe(
      '<script>window.location.replace("/x\\u003c/script>\\u003cscript>alert(1)\\u003c/script>")</script>',
    );
  });

  it("swaps the page, marks it noindex and tells startup not to hydrate it", () => {
    const html = createLateNotFoundRecovery("<main>missing</main>");
    expect(html).toContain(
      '<template id="__farm_late_not_found__"><main>missing</main></template>',
    );
    expect(html).toContain('m.content="noindex"');
    expect(html).toContain('document.documentElement.dataset.farmLateNotFound="true"');
  });
});
