import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { partytown } from "./index.js";

function context(config: Record<string, unknown>) {
  return { config, isDev: true, isProd: false } as never;
}

describe("partytown Farm plugin", () => {
  it("injects a base-path-aware bootstrap into rendered documents", async () => {
    const plugin = partytown({ forward: ["mixpanel.track"] });
    await plugin.configure?.({ basePath: "/app" }, context({ basePath: "/app" }));
    const html = await plugin.render?.html?.(
      "<html><head></head><body><h1>Farm</h1></body></html>",
      { pathname: "/" },
      context({ basePath: "/app" }),
    );

    expect(html).toContain(
      '<script src="/app/~partytown/farm-partytown.js" data-farm-partytown></script>',
    );
  });

  it("registers an early Vite middleware for development assets", async () => {
    const plugin = partytown();
    const configured = (await plugin.configure?.(
      { basePath: "/app", vite: { plugins: [{ name: "existing" }] } },
      context({ basePath: "/app" }),
    )) as any;
    const vitePlugin = configured.vite.plugins[0];
    expect(vitePlugin.name).toBe("farm:partytown-assets");
    expect(vitePlugin.enforce).toBe("pre");

    let middleware: Function | undefined;
    vitePlugin.configureServer({
      middlewares: {
        use(value: Function) {
          middleware = value;
        },
      },
    });
    const response = {
      statusCode: 0,
      headers: new Map<string, string>(),
      body: undefined as Buffer | string | undefined,
      setHeader(name: string, value: string) {
        this.headers.set(name, value);
      },
      end(body?: Buffer | string) {
        this.body = body;
      },
    };
    const next = vi.fn();
    await middleware?.(
      { method: "GET", url: "/app/~partytown/farm-partytown.js?v=1" },
      response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(String(response.body)).toContain('"lib":"/app/~partytown/"');
  });

  it("copies assets once at the correct Nitro build boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "farm-partytown-plugin-"));
    const outputDir = path.join(root, ".farm", ".output");
    const publicDir = path.join(outputDir, "public");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const plugin = partytown();
      await plugin.configure?.({ root }, context({ root }));
      const previous = vi.fn();
      const configured = await plugin.build?.configure?.(
        {
          preset: "node-server",
          output: { dir: outputDir, publicDir },
          hooks: { "rollup:before": previous },
        },
        context({ root }),
      );

      await configured.hooks["rollup:before"]({ options: { preset: "node-server" } });
      await configured.hooks["rollup:before"]({ options: { preset: "node-server" } });
      expect(previous).toHaveBeenCalledTimes(2);
      await expect(
        access(path.join(publicDir, "~partytown", "farm-partytown.js")),
      ).resolves.toBeUndefined();
      expect(info).toHaveBeenCalledOnce();
    } finally {
      info.mockRestore();
      await rm(root, { recursive: true });
    }
  });
});
