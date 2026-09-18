// @vitest-environment node

import fs from "node:fs/promises";
import { createServer as createNodeServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { startDevServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function getAvailablePort(): Promise<number> {
  const server = createNodeServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

it("lets an explicit dev host override the project Vite host", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-host-"));

  try {
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react")),
      path.join(root, "node_modules", "react"),
      "junction",
    );
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react-dom")),
      path.join(root, "node_modules", "react-dom"),
      "junction",
    );
    await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      `export default {
  telemetry: false,
  images: { provider: "none" },
  vite: { server: { host: "0.0.0.0", strictPort: true } },
};\n`,
    );
    await fs.writeFile(
      path.join(root, "src", "app", "layout.tsx"),
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }\n`,
    );
    await fs.writeFile(
      path.join(root, "src", "app", "page.tsx"),
      `import React from "react";
export default function Page() { return <main>host override</main>; }\n`,
    );

    const server = await startDevServer({ root }, await getAvailablePort(), "127.0.0.1");
    try {
      const address = server.httpServer?.address();
      expect(address && typeof address === "object" ? address.address : undefined).toBe(
        "127.0.0.1",
      );
      expect(server.config.server.host).toBe("127.0.0.1");
      await expect(
        fetch(
          `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/`,
        ).then((response) => response.text()),
      ).resolves.toContain("host override");
    } finally {
      await server.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
