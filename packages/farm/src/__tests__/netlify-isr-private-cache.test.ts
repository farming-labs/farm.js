// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

async function createNetlifyFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-netlify-isr-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app", "feed"), { recursive: true });
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  };
  // A cookie guard in front of the admin API, as the docs suggest for config middleware.
  await write(
    "farm.config.ts",
    `export default {
  routeRules: { "/feed": { isr: 60 }, "/api/**": { isr: 60 } },
  middleware: [
    {
      matcher: "/api/admin/:path*",
      async handler(ctx, next) {
        if (!ctx.cookies.get("session")) return new Response("unauthorized", { status: 401 });
        await next();
      },
    },
  ],
};
`,
  );
  await write(
    "src/app/api/me/route.ts",
    `export function GET(request: Request) {
  return Response.json({ user: request.headers.get("cookie") ?? "anonymous" });
}
`,
  );
  await write(
    "src/app/api/admin/users/route.ts",
    `export function GET() { return Response.json({ users: ["admin-only-user"] }); }
`,
  );
  await write(
    "src/app/api/login/route.ts",
    `export function GET() {
  return Response.json({ ok: true }, { headers: { "set-cookie": "session=new; Path=/; HttpOnly" } });
}
`,
  );
  await write(
    "src/app/api/public/route.ts",
    `export function GET() { return Response.json({ public: true }); }
`,
  );
  await write(
    "src/app/api/missing/route.ts",
    `export function GET() { return Response.json({ error: "gone" }, { status: 404 }); }
`,
  );
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
          ...(await loadConfig(root, undefined, "production")),
          root,
          srcDir: "src",
          images: { provider: "none" },
        },
        "production",
      );
      await build(config, { root, preset: "netlify" });

      const functionEntry = path.join(root, ".netlify", "functions-internal", "server", "main.mjs");
      const [
        anonymous,
        withCookie,
        withAuthorization,
        apiMe,
        apiMeBearer,
        adminSignedIn,
        adminAnonymous,
        login,
        missing,
        publicApi,
      ] = await callNetlifyFunction(functionEntry, [
        { path: "/feed" },
        { path: "/feed", headers: { cookie: "session=visitor-a" } },
        { path: "/feed", headers: { authorization: "Bearer visitor-b" } },
        { path: "/api/me", headers: { cookie: "session=alice" } },
        { path: "/api/me", headers: { authorization: "Bearer alice" } },
        { path: "/api/admin/users", headers: { cookie: "session=alice" } },
        { path: "/api/admin/users" },
        { path: "/api/login" },
        { path: "/api/missing" },
        { path: "/api/public" },
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

      // API and guard responses carry no private Cache-Control of their own: a credentialed
      // request, a Set-Cookie, or a status other than 200 keeps them out of the shared cache.
      expect(apiMe!.body).toContain("session=alice");
      expect(adminSignedIn!.body).toContain("admin-only-user");
      expect(adminAnonymous!.status).toBe(401);
      expect(missing!.status).toBe(404);
      for (const response of [
        apiMe!,
        apiMeBearer!,
        adminSignedIn!,
        adminAnonymous!,
        login!,
        missing!,
      ]) {
        expect(response.netlifyCdnCacheControl).toBeNull();
        expect(response.cacheControl ?? "").not.toContain("public");
      }

      // A public API response for an anonymous visitor stays cached at the CDN.
      expect(publicApi!.status).toBe(200);
      expect(publicApi!.netlifyCdnCacheControl).toBe(
        "public, max-age=60, stale-while-revalidate=31536000, durable",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
