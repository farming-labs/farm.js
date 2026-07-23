import { describe, expect, it } from "vitest";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  actionsEnabled: true,
  serverActions: {
    allowedOrigins: [],
    bodySizeLimit: 1_000_000,
  },
  deploymentId: "after-test",
  debug: false,
};

describe("generated after lifecycle", () => {
  it("wraps the complete RSC request instead of individual route branches", () => {
    const entry = generateRscEntry(context);

    expect(entry).toContain("import { _runWithAfterRequest } from '@farmjs/core/after'");
    expect(entry).toContain("async function handleFarmRequest(request)");
    expect(entry).toContain("async function handler(request, context)");
    expect(entry).toContain(
      "return _runWithCurrentRequest(request, () =>\n    _runWithAfterRequest(request, () => handleFarmRequest(request), context)",
    );
    expect(entry).toContain("export default { fetch: handler }");
  });
});
