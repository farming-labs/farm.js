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

  it("turns an SVG import into static image metadata sized from its viewBox, as Next.js does", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-image-vite-svg-"));
    const iconPath = path.join(root, "icon.svg");
    try {
      await fs.writeFile(
        iconPath,
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32"><rect width="48" height="32"/></svg>',
      );
      const plugin = farmImageImportsPlugin();
      if (typeof plugin.resolveId !== "function") throw new Error("Missing resolveId hook");
      if (typeof plugin.load !== "function") throw new Error("Missing load hook");
      const context = { resolve: async () => ({ id: iconPath, external: false }) } as any;
      const importer = path.join(root, "page.tsx");
      const id = await plugin.resolveId.call(context, "./icon.svg", importer, {} as any);
      expect(id).toBe(`\0farm:image:${encodeURIComponent(iconPath)}`);
      // The asset URL and SVGR's component stay what their queries ask for.
      expect(await plugin.resolveId.call(context, "./icon.svg?url", importer, {} as any)).toBe(
        null,
      );
      expect(await plugin.resolveId.call(context, "./icon.svg?react", importer, {} as any)).toBe(
        null,
      );

      const result = await plugin.load.call({} as any, id as string);
      const code = typeof result === "string" ? result : result?.code;
      // The plugin imports the asset with forward slashes, which Vite needs on Windows too.
      const assetRequest = `${iconPath.replace(/\\/g, "/")}?url`;
      expect(code).toContain(`import src from ${JSON.stringify(assetRequest)};`);
      expect(code).toContain('"width":48');
      expect(code).toContain('"height":32');
      // No blur placeholder: an SVG is not rasterized, as in Next.js.
      expect(code).not.toContain("data:image/webp");
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
