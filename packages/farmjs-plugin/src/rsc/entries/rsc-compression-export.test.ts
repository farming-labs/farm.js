import { expect, it } from "vitest";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "compression-test",
  debug: false,
};

const EXPORT =
  "export { compressFarmResponse as farmCompressResponse } from '@farm.js/core/internal/compression-runtime';";

it("exports core's response compression for the Node entry, but not in a Workers build", () => {
  expect(generateRscEntry(context)).toContain(EXPORT);
  // No zlib on workerd, and the platform compresses.
  expect(generateRscEntry({ ...context, workers: true })).not.toContain("compression-runtime");
});
