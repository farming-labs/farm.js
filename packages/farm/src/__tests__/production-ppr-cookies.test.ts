// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer, type ProductionServer } from "./production-server";

// A PPR shell whose render read no cookies is every visitor's page, so a visitor whose browser
// carries cookies (consent, analytics) gets it too. A shell whose render read cookies through a
// helper that does not count a request read (an auth helper, an integration client) is what a
// visitor without them sees, and must never reach, or be stored from, a visitor with them.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const files: Record<string, string> = {
  "package.json": JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "@farm.js/core": "workspace:*" },
  }),
  "src/app/globals.css": "",
  "src/app/layout.tsx": `export default function Layout({ children }) { return <div id="app">{children}</div>; }`,
  // Reads the visitor's session the way @farm.js/auth does: through the current-request resolver.
  "src/lib/session.ts": `
export function session() {
  const request = globalThis[Symbol.for("farm.currentRequestResolver")]?.();
  return request?.headers.get("cookie")?.match(/session=(\\w+)/)?.[1] ?? "anon";
}
`,
  "src/app/shared/page.tsx": `
export const experimental_ppr = true;
export default function Page() { return <p>shared shell</p>; }
`,
  "src/app/encoded/page.tsx": `
export const experimental_ppr = true;
export default function Page() { return <p>ppr-compression-probe</p>; }
`,
  "count-compressions.mjs": `
import fs from "node:fs";
import zlib from "node:zlib";
import { syncBuiltinESMExports } from "node:module";
const compress = zlib.brotliCompress;
zlib.brotliCompress = function(input, ...args) {
  if (Buffer.isBuffer(input) && input.includes("ppr-compression-probe")) {
    fs.appendFileSync(new URL("./compressions.txt", import.meta.url), "br\\n");
  }
  return compress.call(this, input, ...args);
};
syncBuiltinESMExports();
`,
  "src/app/shared-cold/page.tsx": `
export const experimental_ppr = true;
export default function Page() { return <p>shared cold shell</p>; }
`,
  "src/app/session/page.tsx": `
import { session } from "../../lib/session";
export const experimental_ppr = true;
export default function Page() { return <p>{"session=" + session()}</p>; }
`,
  "src/app/session-cold/page.tsx": `
import { session } from "../../lib/session";
export const experimental_ppr = true;
export default function Page() { return <p>{"session=" + session()}</p>; }
`,
};

describe("production PPR shells and visitors with cookies", () => {
  let root = "";
  let base = "";
  let server: ProductionServer | undefined;

  const visit = async (pathname: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      headers: { "accept-encoding": "identity", ...headers },
    });
    expect(response.status).toBe(200);
    return { headers: response.headers, html: await response.text() };
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-ppr-cookies-"));
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
        generateBuildId: () => "ppr-cookies-test",
      },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const probe = pathToFileURL(path.join(root, "count-compressions.mjs")).href;
    server = await startProductionServer(path.join(root, ".farm", ".output", "server"), {
      env: {
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${probe}`].filter(Boolean).join(" "),
      },
    });
    base = server.origin;
  }, 180_000);

  afterAll(async () => {
    // Windows keeps the server directory locked until the process has exited.
    await server?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("serves a shell that read no cookies to a visitor with cookies, kept out of shared caches", async () => {
    expect((await visit("/shared")).headers.get("x-farm-ppr")).toBe("miss");

    const withCookies = await visit("/shared", { cookie: "consent=granted; ph_id=abc" });
    expect(withCookies.html).toContain("shared shell");
    expect(withCookies.headers.get("x-farm-ppr")).toBe("hit");
    expect(withCookies.headers.get("cache-control")).toBe("private, no-store");

    // The visitor without cookies keeps the shared policy.
    const anonymous = await visit("/shared");
    expect(anonymous.headers.get("x-farm-ppr")).toBe("hit");
    expect(anonymous.headers.get("cache-control")).not.toBe("private, no-store");
  });

  it("reuses compressed shell bytes across hits while keeping each visitor's cache policy", async () => {
    const first = await visit("/encoded");
    expect(first.headers.get("x-farm-ppr")).toBe("miss");
    const [anonymous, consent] = await Promise.all([
      visit("/encoded", { "accept-encoding": "br" }),
      visit("/encoded", { "accept-encoding": "br", cookie: "consent=granted" }),
    ]);
    for (const result of [anonymous, consent]) {
      expect(result.headers.get("content-encoding")).toBe("br");
      expect(result.headers.get("x-farm-ppr")).toBe("hit");
      expect(result.html).toBe(first.html);
    }
    expect(anonymous.headers.get("cache-control")).not.toBe("private, no-store");
    expect(consent.headers.get("cache-control")).toBe("private, no-store");
    expect(await fs.readFile(path.join(root, "compressions.txt"), "utf8")).toBe("br\n");
  });

  it("stores the shell from a visitor with cookies when the render read none", async () => {
    const first = await visit("/shared-cold", { cookie: "consent=granted" });
    expect(first.html).toContain("shared cold shell");
    expect(first.headers.get("x-farm-ppr")).toBe("miss");
    expect(first.headers.get("cache-control")).toBe("private, no-store");

    expect(
      (await visit("/shared-cold", { cookie: "consent=denied" })).headers.get("x-farm-ppr"),
    ).toBe("hit");
    expect((await visit("/shared-cold")).headers.get("x-farm-ppr")).toBe("hit");
  });

  it("keeps a shell that read cookies to visitors without them", async () => {
    expect((await visit("/session")).html).toContain("session=anon");
    expect((await visit("/session")).headers.get("x-farm-ppr")).toBe("hit");

    const alice = await visit("/session", { cookie: "session=alice" });
    expect(alice.html).toContain("session=alice");
    expect(alice.html).not.toContain("session=anon");
    expect(alice.headers.get("x-farm-ppr")).toBe("bypass");
    expect(alice.headers.get("cache-control")).toBe("private, no-store");

    // Alice's render did not replace the shell.
    const anonymous = await visit("/session");
    expect(anonymous.html).toContain("session=anon");
    expect(anonymous.headers.get("x-farm-ppr")).toBe("hit");
  });

  it("never stores a shell from a visitor whose cookies the render read", async () => {
    const alice = await visit("/session-cold", { cookie: "session=alice" });
    expect(alice.html).toContain("session=alice");
    expect(alice.headers.get("cache-control")).toBe("private, no-store");

    const anonymous = await visit("/session-cold");
    expect(anonymous.html).toContain("session=anon");
    expect(anonymous.html).not.toContain("alice");

    const bob = await visit("/session-cold", { cookie: "session=bob" });
    expect(bob.html).toContain("session=bob");
    expect(bob.html).not.toContain("alice");
  });

  it("still renders a request with credentials on its own", async () => {
    await visit("/shared");
    const authorized = await visit("/shared", { authorization: "Bearer token" });
    expect(authorized.headers.get("x-farm-ppr")).toBe("bypass");
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
  });
});
