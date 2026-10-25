// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

// A render that reads the request (headers(), cookies(), getCurrentRequest())
// is one visitor's HTML. Wherever the read lives, the production runtime must
// keep it out of the in-process PPR shell cache and out of shared CDN caches.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const files: Record<string, string> = {
  "package.json": JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "@farm.js/core": "workspace:*" },
  }),
  "src/app/globals.css": "",
  "src/app/layout.tsx": `export default function Layout({ children }) { return <div id="app">{children}</div>; }`,
  "src/lib/visitor.ts": `
import { headers } from "@farm.js/core";
export function visitor() { return headers().get("x-user") ?? "anon"; }
`,
  "src/app/ppr-page/page.tsx": `
import { headers } from "@farm.js/core";
export const experimental_ppr = true;
export default function Page() { return <p>{"user=" + (headers().get("x-user") ?? "anon")}</p>; }
`,
  "src/app/ppr-helper/page.tsx": `
import { visitor } from "../../lib/visitor";
export const experimental_ppr = true;
export default function Page() { return <p>{"user=" + visitor()}</p>; }
`,
  "src/app/ppr-static/page.tsx": `
export const experimental_ppr = true;
export default function Page() { return <p>static shell</p>; }
`,
  "src/app/isr-layout/layout.tsx": `
import { visitor } from "../../lib/visitor";
export default function Layout({ children }) { return <section><p>{"layout-user=" + visitor()}</p>{children}</section>; }
`,
  "src/app/isr-layout/page.tsx": `
export const revalidate = 60;
export default function Page() { return <p>isr page</p>; }
`,
  "src/app/isr-plain/page.tsx": `
export const revalidate = 60;
export default function Page() { return <p>isr plain</p>; }
`,
};

describe("production PPR and ISR renders that read the request", () => {
  let root = "";
  let base = "";
  let server: ReturnType<typeof spawn> | undefined;
  const output: string[] = [];

  const visit = async (pathname: string, user?: string) => {
    const response = await fetch(`${base}${pathname}`, {
      headers: { "accept-encoding": "identity", ...(user ? { "x-user": user } : {}) },
    });
    expect(response.status).toBe(200);
    return { headers: response.headers, html: await response.text() };
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-ppr-request-read-"));
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const name of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", name)),
        path.join(root, "node_modules", name),
        "junction",
      );
    }
    for (const [file, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), source.trim());
    }

    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        experimental: { ppr: true },
        generateBuildId: () => "ppr-request-read-test",
      },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const serverDirectory = path.join(root, ".farm", ".output", "server");
    const port = await getAvailablePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
      cwd: serverDirectory,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => output.push(String(chunk)));
    server.stderr?.on("data", (chunk) => output.push(String(chunk)));
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        await fetch(`${base}/isr-plain`);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error(`Production server did not start\n${output.join("")}`);
  }, 180_000);

  afterAll(async () => {
    // Windows keeps the server directory locked until the process has exited.
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolve) => server?.once("exit", resolve));
      server.kill();
      await exited;
    }
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each(["/ppr-page", "/ppr-helper"])(
    "never serves one visitor's %s render to the next from the PPR shell cache",
    async (pathname) => {
      const alice = await visit(pathname, "alice");
      const bob = await visit(pathname, "bob");
      expect(bob.html).not.toContain("alice");
      expect(bob.html).toContain("user=bob");
      expect(bob.headers.get("x-farm-ppr")).toBe("bypass");
      expect(bob.headers.get("cache-control")).toBe("private, no-store");

      expect(alice.html).toContain("user=alice");
      expect(alice.headers.get("x-farm-ppr")).toBe("bypass");
      expect(alice.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("still caches a PPR shell that does not read the request", async () => {
    await visit("/ppr-static");
    const second = await visit("/ppr-static");
    expect(second.html).toContain("static shell");
    expect(second.headers.get("x-farm-ppr")).toBe("hit");
  });

  it("keeps an ISR page private when its layout reads the request", async () => {
    const alice = await visit("/isr-layout", "alice");
    expect(alice.html).toContain("layout-user=alice");
    expect(alice.headers.get("cache-control")).toBe("private, no-store");

    const bob = await visit("/isr-layout", "bob");
    expect(bob.html).toContain("layout-user=bob");
    expect(bob.headers.get("cache-control")).toBe("private, no-store");

    // An ISR page that renders the same HTML for everyone keeps its shared policy.
    expect((await visit("/isr-plain")).headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });
});
