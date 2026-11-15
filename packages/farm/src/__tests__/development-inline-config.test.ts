// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { resolveConfig, type FarmUserConfig } from "../config";
import type { FarmConfig } from "../types";
import { defineIntegration } from "../integrations";
import { getResolvedEnv, setEnv } from "../env";
import { createServer, startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const servers = new Set<ViteDevServer>();
const configKeys = new Set<symbol>();
const originalEnv = getResolvedEnv();

afterEach(async () => {
  for (const server of servers) await server.close();
  servers.clear();
  setEnv(originalEnv);
  vi.unstubAllEnvs();
  for (const key of configKeys) Reflect.deleteProperty(globalThis, key);
  configKeys.clear();
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

async function createProject() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-inline-config-")));
  roots.push(root);
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.mkdir(path.join(root, "src", "app", "api", "ping"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    "export default function Layout({ children }) { return <>{children}</>; }",
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    "export default function Page() { return <main>inline config control</main>; }",
  );
  await fs.writeFile(
    path.join(root, "src", "app", "api", "ping", "route.ts"),
    "export function GET() { return Response.json({ ok: true }); }",
  );
  const config: FarmUserConfig = {
    root,
    images: { provider: "none" },
    vite: {
      plugins: [
        {
          name: "capture-test-server",
          configureServer: {
            order: "pre",
            handler(server) {
              servers.add(server);
            },
          },
        },
      ],
    },
  };
  return { root, config };
}

async function writeConfig(root: string, config: FarmUserConfig) {
  configKeys.add(Symbol.for(root));
  Reflect.set(globalThis, Symbol.for(root), config);
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default globalThis[Symbol.for(${JSON.stringify(root)})];`,
  );
}

function origin(server: ViteDevServer) {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return `http://localhost:${address.port}`;
}

async function request(server: ViteDevServer, pathname: string) {
  const response = await fetch(`${origin(server)}${pathname}`, { redirect: "manual" });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

describe("development inline config", () => {
  it.each(["inline", "file"])(
    "registers %s plugins and routing rules once across restart",
    async (source) => {
      const { root, config } = await createProject();
      const calls: string[] = [];
      config.plugins = [
        {
          name: "inline-resource",
          init() {
            calls.push("init");
          },
          setup({ lifecycle }) {
            calls.push("setup");
            lifecycle.onShutdown(() => {
              calls.push("dispose");
            });
          },
          runtime: {
            start() {
              calls.push("start");
            },
          },
          beforeRequest(req, res) {
            if (req.url?.split("?")[0] === "/resource") res.end("resource open");
          },
        },
      ];
      config.redirects = vi.fn(async () => [{ source: "/old", destination: "/resource" }]);
      config.headers = vi.fn(() => [
        { source: "/resource", headers: [{ key: "X-Inline", value: "installed" }] },
      ]);
      config.rewrites = vi.fn(async () => [{ source: "/alias", destination: "/resource" }]);
      if (source === "file") await writeConfig(root, config);
      const server = await startDevServer(
        source === "file" ? { root } : config,
        await getAvailablePort(),
      );
      servers.add(server);
      for (const restart of [false, true]) {
        if (restart) await server.restart();
        const resource = await request(server, "/resource");
        expect(resource.status).toBe(200);
        expect(resource.body).toBe("resource open");
        expect(resource.headers.get("x-inline")).toBe("installed");
        const redirect = await request(server, "/old?tag=a&tag=b");
        expect(redirect.status).toBe(307);
        expect(redirect.headers.get("location")).toBe("/resource?tag=a&tag=b");
        expect(await request(server, "/alias?tag=a&tag=b")).toMatchObject({
          status: 200,
          body: "resource open",
        });
        expect(calls).toEqual(["init", "setup", "start"]);
      }
      expect(config.redirects).toHaveBeenCalledTimes(1);
      expect(config.headers).toHaveBeenCalledTimes(1);
      expect(config.rewrites).toHaveBeenCalledTimes(1);
      await Promise.all([server.close(), server.close()]);
      expect(calls).toEqual(["init", "setup", "start", "dispose"]);
    },
    60_000,
  );

  it("keeps file config authoritative while the explicit port still wins", async () => {
    const { root, config } = await createProject();
    const fileSetup = vi.fn();
    const inlineSetup = vi.fn();
    config.plugins = [{ name: "file-plugin", setup: fileSetup }];
    await writeConfig(root, config);
    const port = await getAvailablePort();
    const server = await startDevServer(
      { root, plugins: [{ name: "inline-plugin", setup: inlineSetup }] },
      port,
    );
    servers.add(server);
    expect(origin(server)).toBe(`http://localhost:${port}`);
    expect(fileSetup).toHaveBeenCalledTimes(1);
    expect(inlineSetup).not.toHaveBeenCalled();
    expect((await request(server, "/")).body).toContain("inline config control");
  }, 60_000);

  it("resolves inline environment and API callbacks before startup without mutating the input", async () => {
    const { config } = await createProject();
    const parse = vi.fn(() => "public-value");
    const parseSecret = vi.fn((value) => value);
    vi.stubEnv("INLINE_CONFIG_SECRET", "server-only-value");
    const apiPath = vi.fn(({ env }) =>
      env.public.APP_LABEL === "public-value" ? "/service" : "/wrong",
    );
    config.env = {
      public: { APP_LABEL: parse },
      server: { INLINE_CONFIG_SECRET: { parse: parseSecret } },
    };
    config.api = { basePath: apiPath };
    Object.freeze(config);
    const server = await startDevServer(config, await getAvailablePort());
    servers.add(server);
    expect(await request(server, "/service/ping")).toMatchObject({
      status: 200,
      body: '{"ok":true}',
    });
    expect(server.config.define?.__FARM_PUBLIC_ENV__).toBe('{"APP_LABEL":"public-value"}');
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parseSecret).toHaveBeenCalledExactlyOnceWith("server-only-value");
    expect(getResolvedEnv().server.INLINE_CONFIG_SECRET).toBe("server-only-value");
    expect(apiPath).toHaveBeenCalledTimes(1);
    expect(config.env.public.APP_LABEL).toBe(parse);
    expect(config.api.basePath).toBe(apiPath);
  }, 60_000);

  it("preserves already-resolved config without parsing environment values again", async () => {
    const { config } = await createProject();
    const parse = vi.fn(() => "resolved-value");
    config.env = { public: { APP_LABEL: parse } };
    const resolved = await resolveConfig(config, "development");
    setEnv({ server: {}, public: {} });
    Object.freeze(resolved);
    const server = await startDevServer(resolved, await getAvailablePort());
    servers.add(server);
    expect(server.config.define?.__FARM_PUBLIC_ENV__).toBe('{"APP_LABEL":"resolved-value"}');
    expect(parse).toHaveBeenCalledTimes(1);
    expect(getResolvedEnv().public.APP_LABEL).toBe("resolved-value");
    expect((await request(server, "/")).status).toBe(200);
  }, 60_000);

  it.each([false, true])(
    "registers layers and integration plugins once (pre-resolved: %s)",
    async (preResolved) => {
      const { root, config } = await createProject();
      const layerRoot = path.join(root, "base");
      await fs.mkdir(layerRoot);
      const layerSetup = vi.fn();
      await writeConfig(layerRoot, { plugins: [{ name: "inline-layer", setup: layerSetup }] });
      const setup = vi.fn();
      const dispose = vi.fn();
      config.extends = ["./base"];
      config.integrations = {
        cache: defineIntegration({
          category: "cache",
          type: "inline-test",
          instance: {},
          setup,
          dispose,
        }),
      };
      const input = preResolved ? await resolveConfig(config, "development") : config;
      const server = await startDevServer(input, await getAvailablePort());
      servers.add(server);
      const actual = (server as ViteDevServer & { __farmResolvedConfig: FarmConfig })
        .__farmResolvedConfig;
      expect(actual.plugins?.map((plugin) => plugin.name)).toEqual([
        "farm:integration:cache:inline-test",
        "inline-layer",
      ]);
      await server.restart();
      expect(setup).toHaveBeenCalledTimes(1);
      expect(layerSetup).toHaveBeenCalledTimes(1);
      expect((await request(server, "/")).status).toBe(200);
      await server.close();
      expect(dispose).toHaveBeenCalledTimes(1);
    },
    60_000,
  );

  it("preserves resolved fields in a partial runtime config", async () => {
    const { config } = await createProject();
    const resolved = await resolveConfig(
      { ...config, auth: { enabled: false, emailAndPassword: false } },
      "development",
    );
    const runtimeConfig: FarmConfig = {
      ...config,
      i18n: resolved.i18n,
      docs: resolved.docs,
      auth: resolved.auth,
      layers: resolved.layers,
    };
    const server = await createServer(runtimeConfig);
    servers.add(server);
    const actual = (server as ViteDevServer & { __farmResolvedConfig: FarmConfig })
      .__farmResolvedConfig;
    expect(actual.i18n).toEqual(resolved.i18n);
    expect(actual.docs).toEqual(resolved.docs);
    expect(actual.auth).toEqual(resolved.auth);
  }, 60_000);

  it("preserves literal environment values accepted by the runtime config type", async () => {
    const { config } = await createProject();
    const runtimeConfig: FarmConfig = {
      ...config,
      env: { server: {}, public: { APP_LABEL: "literal", APP_COUNT: 2 } },
    };
    const server = await createServer(runtimeConfig);
    servers.add(server);
    expect(server.config.define?.__FARM_PUBLIC_ENV__).toBe('{"APP_LABEL":"literal","APP_COUNT":2}');
  }, 60_000);

  it("validates inline route rules before Vite or plugin setup", async () => {
    const { config } = await createProject();
    const setup = vi.fn();
    config.plugins = [{ name: "must-not-start", setup }];
    config.redirects = () => [{ source: "/unsafe/%2fpath", destination: "/safe" }];
    await expect(createServer(config).then(() => undefined)).rejects.toThrow(/browser-unstable/);
    expect(setup).not.toHaveBeenCalled();
    expect(servers.size).toBe(0);
  }, 60_000);

  it("cleans up an inline plugin whose setup fails", async () => {
    const { config } = await createProject();
    const failure = new Error("inline setup failed");
    const dispose = vi.fn();
    config.plugins = [
      {
        name: "failing-inline-plugin",
        setup({ lifecycle }) {
          lifecycle.onShutdown(dispose);
          throw failure;
        },
      },
    ];
    await expect(createServer(config).then(() => undefined)).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect([...servers].every((server) => server.watcher.closed)).toBe(true);
  }, 60_000);
});
