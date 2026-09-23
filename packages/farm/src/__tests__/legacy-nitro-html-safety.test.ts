// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  renderFarmLegacyErrorHtml,
  renderFarmLegacyHtml,
  serializeFarmInlineValue,
} from "../nitro/legacy-runtime";

describe("legacy Nitro HTML safety", () => {
  it("escapes every inline runtime value in rendered HTML", () => {
    const attack = "</script><script>alert(1)</script>\u2028\u2029";
    const html = renderFarmLegacyHtml({
      deploymentId: attack,
      pageProps: { attack },
      pathname: attack,
      html: "<main>safe</main>",
      clientScript: '/assets/page.js"><img src=x onerror=alert(1)>',
    });

    expect(html).not.toContain(attack);
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain('src="/assets/page.js&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
    expect(html).not.toContain("\u2028");
    expect(html).not.toContain("\u2029");
    expect(html.match(/\\u003c\/script>/g)).toHaveLength(6);
    expect(html.match(/\\u2028/g)).toHaveLength(3);
    expect(html.match(/\\u2029/g)).toHaveLength(3);
    expect(html).toContain(`window.__FARM_DEPLOYMENT_ID__ = ${serializeFarmInlineValue(attack)}`);
  });

  it("returns a generic production error document", () => {
    const html = renderFarmLegacyErrorHtml();

    expect(html).toContain("Internal Server Error");
    expect(html).not.toContain("database password");
  });
});
