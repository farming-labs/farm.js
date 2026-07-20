// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { farmImageImportsPlugin } from "../image-vite";

describe("Farm static image imports", () => {
  it("turns Vite asset modules into static image metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-image-vite-"));
    const imagePath = path.join(root, "product.png");

    try {
      await sharp({
        create: {
          width: 120,
          height: 80,
          channels: 4,
          background: { r: 49, g: 130, b: 83, alpha: 1 },
        },
      })
        .png()
        .toFile(imagePath);

      const plugin = farmImageImportsPlugin();
      expect(typeof plugin.transform).toBe("function");
      if (typeof plugin.transform !== "function") throw new Error("Missing transform hook");
      const result = await plugin.transform.call(
        {} as any,
        'export default "/assets/product-a1b2.png";',
        imagePath,
        { ssr: true },
      );
      const code = typeof result === "string" ? result : result?.code;

      expect(code).toContain('const src = "/assets/product-a1b2.png";');
      expect(code).toContain('"width":120');
      expect(code).toContain('"height":80');
      expect(code).toContain('"blurDataURL":"data:image/webp;base64,');
      expect(code).toContain("export default image;");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps explicit raw URL imports untouched", async () => {
    const plugin = farmImageImportsPlugin();
    if (typeof plugin.transform !== "function") throw new Error("Missing transform hook");
    const result = await plugin.transform.call(
      {} as any,
      'export default "/assets/product.png";',
      "/project/product.png?url",
      { ssr: false },
    );

    expect(result).toBeNull();
  });
});
