// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse as VercelImageResponse } from "@vercel/og";
import { imageSize } from "image-size";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import * as og from "../og";
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

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

describe("@farm.js/core/og", () => {
  it("re-exports the @vercel/og ImageResponse that metadata images use", () => {
    expect(Object.keys(og)).toEqual(["ImageResponse"]);
    expect(og.ImageResponse).toBe(VercelImageResponse);
  });

  it("renders JSX to a PNG response with caller headers", async () => {
    const response = new og.ImageResponse(
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          color: "white",
        }}
      >
        Farm.js
      </div>,
      { width: 240, height: 126, headers: { "cache-control": "public, max-age=60" } },
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(imageSize(bytes)).toMatchObject({ width: 240, height: 126, type: "png" });
  });

  it("serves an ImageResponse from a development API route", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-og-"));
    temporaryRoots.add(root);

    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    // Generated apps compile JSX with the automatic runtime.
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"jsx":"react-jsx","module":"ESNext","moduleResolution":"bundler"}}',
    );
    await writeModule(
      root,
      "src/app/layout.tsx",
      "export default function Layout({ children }) { return <>{children}</>; }",
    );
    await writeModule(
      root,
      "src/app/page.tsx",
      "export default function Page() { return <main>home</main>; }",
    );
    await writeModule(
      root,
      "src/app/api/card/route.tsx",
      `import { ImageResponse } from "@farm.js/core/og";

export function GET(request: Request) {
  const title = new URL(request.url).searchParams.get("title") ?? "Farm.js";
  return new ImageResponse(<div style={{ display: "flex" }}>{title}</div>, {
    width: 300,
    height: 158,
  });
}
`,
    );

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    const response = await fetch(`http://localhost:${address.port}/api/card?title=Dev`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(imageSize(bytes)).toMatchObject({ width: 300, height: 158, type: "png" });
  }, 60_000);
});
