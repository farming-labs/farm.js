import { describe, expect, it } from "vitest";

import { convex } from "../index.js";
import { readConvexRuntime } from "../runtime.js";

describe("convex()", () => {
  const url = "https://happy-otter-123.convex.cloud";

  it("wraps the app in the Convex provider with the public deployment URL only", () => {
    const integration = convex({ url, dev: false });
    expect(integration.providers).toEqual([
      {
        name: "convex-provider",
        type: "convex",
        props: { url },
        supportsIsolatedHydration: true,
        component: { module: "@farm.js/convex/client", export: "ConvexClientProvider" },
      },
    ]);
  });

  it("uses a provider the app owns when one is given", () => {
    const provider = { module: "@/lib/convex-provider", export: "AppConvexProvider" };
    const integration = convex({ url, provider, dev: false });
    expect(integration.providers?.[0]?.component).toEqual(provider);
  });

  it("shares the deployment URLs and token reader with the server helpers", () => {
    const token = () => "token";
    convex({ url, token, dev: false });
    expect(readConvexRuntime()).toEqual({
      url,
      siteURL: "https://happy-otter-123.convex.site",
      token,
    });
  });

  it("adds the farm:convex plugin", () => {
    const integration = convex({ url });
    expect(integration.plugins?.map((plugin) => plugin.name)).toEqual(["farm:convex"]);
  });
});
