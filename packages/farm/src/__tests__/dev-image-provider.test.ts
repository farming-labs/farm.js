// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startDevServer } from "../server/create-server";

// Development SSR loads @farm.js/core/image without Vite's transform, so the
// __FARM_IMAGE_CONFIG__ define never reached it and server-rendered images
// pointed at the optimizer even when it was not mounted. The Sharp fallback
// (`auto` without sharp behaves as `none`) depends on these agreeing.
describe("development image provider", () => {
  it("renders original image URLs when images.provider is none", async () => {
    const packageRoot = process.cwd();
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-image-provider-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `import { Image } from "@farm.js/core/image";
export default function Page() {
  return <main><Image src="/hero.png" width={64} height={64} alt="hero" /></main>;
}
`,
      );
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `import { defineConfig } from "@farm.js/core";
export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  // An installed core is external in dev SSR; a symlinked one is inlined.
  vite: { server: { host: "127.0.0.1", strictPort: false }, ssr: { external: ["@farm.js/core"] } },
});
`,
      );

      const dev = await startDevServer({ root }, 0);
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string") {
          throw new Error("Dev server did not bind a TCP port");
        }
        const base = `http://127.0.0.1:${address.port}`;

        const html = await (await fetch(`${base}/`)).text();
        expect(html).toMatch(/<img[^>]*src="\/hero\.png"/);
        expect(html).not.toContain("/_farm/image");
        expect((await fetch(`${base}/_farm/image`)).status).toBe(404);
      } finally {
        await dev.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
