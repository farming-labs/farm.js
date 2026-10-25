// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

async function createNetlifyFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-netlify-isr-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app", "feed"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "feed", "page.tsx"),
    `export const revalidate = 60;

export default function Feed() {
  return <main>netlify-isr-feed</main>;
}`,
  );
  return root;
}

/** Call the built Netlify function the way Netlify does, in a fresh Node process. */
async function callNetlifyFunction(
  functionEntry: string,
  requests: Array<{ path: string; headers?: Record<string, string> }>,
) {
  const script = `
const { default: handler } = await import(${JSON.stringify(pathToFileURL(functionEntry).href)});
const results = [];
for (const input of ${JSON.stringify(requests)}) {
  const response = await handler(new Request("https://site.netlify.app" + input.path, { headers: input.headers }), {});
  results.push({
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    netlifyCdnCacheControl: response.headers.get("netlify-cdn-cache-control"),
    body: await response.text(),
  });
}
process.stdout.write(JSON.stringify(results));
process.exit(0);
`;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.dirname(functionEntry),
    env: { ...process.env, NODE_ENV: "production" },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as Array<{
    status: number;
    cacheControl: string | null;
    netlifyCdnCacheControl: string | null;
    body: string;
  }>;
}

describe("Netlify isr route responses", () => {
  it("never give a private response a shared Netlify CDN cache directive", async () => {
    const root = await createNetlifyFixture();
    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          routeRules: { "/feed": { isr: 60 } },
        },
        "production",
      );
      await build(config, { root, preset: "netlify" });

      const functionEntry = path.join(root, ".netlify", "functions-internal", "server", "main.mjs");
      const [anonymous, withCookie, withAuthorization] = await callNetlifyFunction(functionEntry, [
        { path: "/feed" },
        { path: "/feed", headers: { cookie: "session=visitor-a" } },
        { path: "/feed", headers: { authorization: "Bearer visitor-b" } },
      ]);

      expect(anonymous!.status).toBe(200);
      expect(anonymous!.body).toContain("netlify-isr-feed");
      expect(anonymous!.netlifyCdnCacheControl).toBe(
        "public, max-age=60, stale-while-revalidate=31536000, durable",
      );

      for (const response of [withCookie!, withAuthorization!]) {
        expect(response.status).toBe(200);
        expect(response.cacheControl).toContain("private");
        expect(response.netlifyCdnCacheControl).toBeNull();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
