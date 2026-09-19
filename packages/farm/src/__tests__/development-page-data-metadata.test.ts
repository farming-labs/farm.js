// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close().catch(() => {})));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function createProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-page-data-metadata-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');

  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export const metadata = {
  openGraph: { siteName: "Farm Shop" },
};
export function generateMetadata() {
  return { description: "From the layout" };
}
export default function Layout({ children }) {
  return <>{children}</>;
}`,
  );
  await writeModule(
    root,
    "src/app/products/[id]/page.tsx",
    `import React from "react";
export function generateMetadata(props) {
  return {
    title: \`Product \${props.params.id}\`,
    openGraph: { title: \`Product \${props.params.id}\` },
  };
}
export default function Page() {
  return <main>product</main>;
}`,
  );

  return root;
}

describe("development page-data generated metadata", () => {
  it("runs generateMetadata for the page-data payload the way a full load does", async () => {
    const root = await createProject();
    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(0);
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    const response = await fetch(
      `http://localhost:${address.port}/__farm/page-data?path=/products/42`,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { metadata?: Record<string, any> };

    // The route's generateMetadata ran with its resolved props.
    expect(payload.metadata?.title).toBe("Product 42");
    // The layout's generateMetadata contributed too.
    expect(payload.metadata?.description).toBe("From the layout");
    // Deep merge: the page's generated openGraph extends the layout's static
    // openGraph instead of replacing it, matching mergeMetadata on full loads.
    expect(payload.metadata?.openGraph).toMatchObject({
      siteName: "Farm Shop",
      title: "Product 42",
    });
  }, 60_000);
});
