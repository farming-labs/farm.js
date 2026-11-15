// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { FARM_NOT_FOUND_TITLE, renderMetadataHead, resolveFarmNotFoundMetadata } from "../metadata";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

const title = (metadata: Record<string, any>) => renderMetadataHead(metadata).title;

describe("resolveFarmNotFoundMetadata", () => {
  it("names the page 404 by default, through a layout's title template", async () => {
    expect(title(await resolveFarmNotFoundMetadata([], null))).toBe(FARM_NOT_FOUND_TITLE);
    const layout = { metadata: { title: { template: "%s | Acme", default: "Acme" } } };
    expect(title(await resolveFarmNotFoundMetadata([layout], null))).toBe(
      `${FARM_NOT_FOUND_TITLE} | Acme`,
    );
  });

  it("lets the not-found module set its own title and keeps the layout's other metadata", async () => {
    const layout = {
      metadata: { title: { template: "%s | Acme", default: "Acme" }, description: "Acme app" },
    };
    const metadata = await resolveFarmNotFoundMetadata([layout], {
      metadata: { title: "Page not found" },
    });
    expect(title(metadata)).toBe("Page not found | Acme");
    expect(metadata.description).toBe("Acme app");
    const generated = await resolveFarmNotFoundMetadata([layout], {
      metadata: { title: "Page not found" },
      generateMetadata: async () => ({ title: "Lost?" }),
    });
    expect(title(generated)).toBe("Lost? | Acme");
  });

  it("keeps an absolute not-found title out of the layout's template", async () => {
    const layout = { metadata: { title: { template: "%s | Acme", default: "Acme" } } };
    const metadata = await resolveFarmNotFoundMetadata([layout], {
      metadata: { title: { absolute: "Acme" } },
    });
    expect(title(metadata)).toBe("Acme");
    const generated = await resolveFarmNotFoundMetadata([layout], {
      generateMetadata: async () => ({ title: { absolute: "Nothing here" } }),
    });
    expect(title(generated)).toBe("Nothing here");
  });

  it("still applies the not-found module's own template to its generated title", async () => {
    const layout = { metadata: { title: { template: "%s | Acme", default: "Acme" } } };
    const metadata = await resolveFarmNotFoundMetadata([layout], {
      metadata: { title: { template: "%s (404)", default: "Missing" } },
      generateMetadata: async () => ({ title: "Lost?" }),
    });
    expect(title(metadata)).toBe("Lost? (404) | Acme");
  });
});

async function startProject(notFound: string | null): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-not-found-metadata-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  const write = async (relativePath: string, source: string) => {
    const filePath = path.join(root, "src", "app", relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source);
  };
  await write(
    "layout.tsx",
    `import React from "react";
export const metadata = { title: { template: "%s | Acme", default: "Acme" }, description: "Acme app" };
export default function Layout({ children }) { return <div id="layout">{children}</div>; }`,
  );
  await write(
    "page.tsx",
    `import React from "react";
export default function Page() { return <main>home</main>; }`,
  );
  if (notFound) await write("not-found.tsx", notFound);

  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development not-found document", () => {
  it("takes its title from the not-found page and the root layout", async () => {
    const origin = await startProject(`import React from "react";
export const metadata = { title: "Page not found" };
export default function NotFound() { return <main>custom not found</main>; }`);
    const response = await fetch(`${origin}/missing`);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("custom not found");
    expect(html.match(/<title>[^<]*<\/title>/g)).toEqual(["<title>Page not found | Acme</title>"]);
    expect(html).toContain('<meta name="description" content="Acme app"');
  }, 60_000);

  it("names the default 404 page through the layout's title template", async () => {
    const origin = await startProject(null);
    const response = await fetch(`${origin}/missing`);
    expect(response.status).toBe(404);
    expect((await response.text()).match(/<title>[^<]*<\/title>/g)).toEqual([
      `<title>${FARM_NOT_FOUND_TITLE} | Acme</title>`,
    ]);
  }, 60_000);
});
