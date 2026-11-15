// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { farmPlugin } from "../vite";
import {
  createBundledEnv,
  env,
  getEnv,
  getPublicEnv,
  getResolvedEnv,
  publicEnv,
  resolveEnv,
  serverEnv,
  setEnv,
} from "../env";

const runtimeKeys = ["DATABASE_URL", "PORT", "FEATURE_FLAG", "ALLOWED_HOSTS"];

afterEach(() => {
  setEnv({ server: {}, public: {} });
  for (const key of runtimeKeys) delete process.env[key];
  vi.restoreAllMocks();
});

describe("env", () => {
  it("validates server and public env from parser schemas", () => {
    const resolved = resolveEnv(
      {
        server: {
          DATABASE_URL: {
            parse(value: unknown) {
              if (typeof value !== "string" || !value.startsWith("postgres://")) {
                throw new Error("expected postgres url");
              }

              return value;
            },
          },
        },
        public: {
          PUBLIC_APP_URL: {
            parse(value: unknown) {
              return String(value);
            },
          },
        },
      },
      {
        DATABASE_URL: "postgres://localhost/farm",
        PUBLIC_APP_URL: "https://farm.test",
      },
    );
    setEnv(resolved);

    expect(getResolvedEnv()).toEqual({
      server: { DATABASE_URL: "postgres://localhost/farm" },
      public: { PUBLIC_APP_URL: "https://farm.test" },
    });
    expect(getEnv()).toEqual({ DATABASE_URL: "postgres://localhost/farm" });
    expect(getEnv("DATABASE_URL")).toBe("postgres://localhost/farm");
    expect(getPublicEnv()).toEqual({ PUBLIC_APP_URL: "https://farm.test" });
    expect(getPublicEnv("PUBLIC_APP_URL")).toBe("https://farm.test");
    expect(env.DATABASE_URL).toBe("postgres://localhost/farm");
    expect(serverEnv.DATABASE_URL).toBe("postgres://localhost/farm");
    expect(publicEnv.PUBLIC_APP_URL).toBe("https://farm.test");
  });

  it("supports parser functions and useful validation errors", () => {
    const envConfig = {
      server: {
        PORT: (value: string | undefined) => {
          const port = Number(value);
          if (!Number.isInteger(port)) {
            throw new Error("expected integer");
          }

          return port;
        },
      },
    };

    expect(resolveEnv(envConfig, { PORT: "3000" }).server.PORT).toBe(3000);
    expect(() => resolveEnv(envConfig, { PORT: "nope" })).toThrow(
      'Invalid server env "PORT": expected integer',
    );
  });

  it("only exposes public env to browser bundles", () => {
    const plugin = farmPlugin({
      env: {
        server: { SECRET: "server-only" },
        public: { PUBLIC_APP_URL: "https://farm.test" },
      },
      images: {
        path: "/media/image",
        qualities: [60, 80],
        remotePatterns: [{ hostname: "images.example.test" }],
        dangerouslyAllowLocalIP: true,
      },
    });

    const publicImageConfig = JSON.stringify({
      provider: "auto",
      path: "/media/image",
      deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
      qualities: [60, 80],
      formats: ["image/webp"],
    });

    const browserConfig = (plugin.config as any)?.(
      {},
      { command: "build", mode: "production", isSsrBuild: false },
    );
    expect(browserConfig.define).toEqual({
      __FARM_API_BASE_URL__: JSON.stringify("/api"),
      __FARM_PUBLIC_ENV__: JSON.stringify({ PUBLIC_APP_URL: "https://farm.test" }),
      __FARM_IMAGE_CONFIG__: publicImageConfig,
    });

    const ssrConfig = (plugin.config as any)?.(
      {},
      { command: "build", mode: "production", isSsrBuild: true },
    );
    expect(ssrConfig.define).toEqual({
      __FARM_API_BASE_URL__: JSON.stringify("/api"),
      __FARM_PUBLIC_ENV__: JSON.stringify({ PUBLIC_APP_URL: "https://farm.test" }),
      __FARM_IMAGE_CONFIG__: publicImageConfig,
      __FARM_ENV__: JSON.stringify({
        server: { SECRET: "server-only" },
        public: { PUBLIC_APP_URL: "https://farm.test" },
      }),
    });
  });

  describe("server env in build output", () => {
    const resolved = {
      server: {
        DATABASE_URL: "postgres://build-secret",
        PORT: 3000,
        FEATURE_FLAG: true,
        ALLOWED_HOSTS: ["a.test"],
        REGION: "iad1",
      },
      public: { PUBLIC_APP_URL: "https://farm.test" },
    };
    const buildEnvironment = {
      DATABASE_URL: "postgres://build-secret",
      PORT: "3000",
      FEATURE_FLAG: "true",
      ALLOWED_HOSTS: '["a.test"]',
    };

    it("leaves values that came from the build environment out of the bundle", () => {
      const bundled = createBundledEnv(resolved, buildEnvironment);

      expect(JSON.stringify(bundled)).not.toContain("build-secret");
      expect(bundled).toEqual({
        // REGION was produced by its parser without an env var, like a default.
        server: { REGION: "iad1" },
        public: { PUBLIC_APP_URL: "https://farm.test" },
        runtime: {
          server: {
            DATABASE_URL: "string",
            PORT: "number",
            FEATURE_FLAG: "boolean",
            ALLOWED_HOSTS: "json",
          },
        },
      });
    });

    it("reads those values from the server environment with their build-time types", () => {
      setEnv(createBundledEnv(resolved, buildEnvironment));
      process.env.DATABASE_URL = "postgres://rotated";
      process.env.PORT = "8080";
      process.env.FEATURE_FLAG = "false";
      process.env.ALLOWED_HOSTS = '["b.test","c.test"]';

      expect(getEnv("DATABASE_URL")).toBe("postgres://rotated");
      expect(env.PORT).toBe(8080);
      expect(serverEnv.FEATURE_FLAG).toBe(false);
      expect(getEnv("ALLOWED_HOSTS")).toEqual(["b.test", "c.test"]);
      expect(getEnv("REGION")).toBe("iad1");
      expect(getResolvedEnv().public).toEqual({ PUBLIC_APP_URL: "https://farm.test" });
    });

    it("picks up a value that appears after startup and warns once for a missing one", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      setEnv(createBundledEnv(resolved, buildEnvironment));

      expect(getEnv("DATABASE_URL")).toBeUndefined();
      expect(env.DATABASE_URL).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('"DATABASE_URL"');

      // Edge runtimes can populate process.env after the module loads.
      process.env.DATABASE_URL = "postgres://late";
      expect(getEnv("DATABASE_URL")).toBe("postgres://late");
    });

    it("keeps a value that is not a number or boolean as the raw string", () => {
      setEnv(createBundledEnv(resolved, buildEnvironment));
      process.env.PORT = "not-a-port";
      process.env.FEATURE_FLAG = "maybe";

      expect(getEnv("PORT")).toBe("not-a-port");
      expect(getEnv("FEATURE_FLAG")).toBe("maybe");
    });

    it("reads runtime bindings that Cloudflare Workers expose on globalThis.__env__", () => {
      const runtime = globalThis as typeof globalThis & { __env__?: Record<string, unknown> };
      setEnv(createBundledEnv(resolved, buildEnvironment));
      runtime.__env__ = { DATABASE_URL: "postgres://worker-binding", PORT: "8787" };
      try {
        expect(getEnv("DATABASE_URL")).toBe("postgres://worker-binding");
        expect(env.PORT).toBe(8787);
      } finally {
        delete runtime.__env__;
      }
    });

    it("keeps a value in the bundle when its parser does more than the runtime can repeat", () => {
      const config = {
        server: {
          FEATURE_FLAG: (value: string | undefined) => value === "on",
          TIMEOUT_MS: (value: string | undefined) => Number(value) * 1000,
          ALLOWED_HOSTS: (value: string | undefined) => (value ?? "").split(","),
          API_ORIGIN: (value: string | undefined) => new URL(value ?? "").origin,
          PORT: (value: string | undefined) => Number(value),
        },
      };
      const source = {
        FEATURE_FLAG: "off",
        TIMEOUT_MS: "60",
        ALLOWED_HOSTS: "a.test,b.test",
        API_ORIGIN: "https://api.farm.test/v1",
        PORT: "3000",
      };
      const bundled = createBundledEnv(resolveEnv(config, source), source);

      expect(bundled.server).toEqual({
        FEATURE_FLAG: false,
        TIMEOUT_MS: 60000,
        ALLOWED_HOSTS: ["a.test", "b.test"],
        API_ORIGIN: "https://api.farm.test",
      });
      // A value the runtime coerces back to the same parsed value is still read at runtime.
      expect(bundled.runtime).toEqual({ server: { PORT: "number" } });

      setEnv(bundled);
      process.env.PORT = "8080";
      expect(getEnv("FEATURE_FLAG")).toBe(false);
      expect(getEnv("TIMEOUT_MS")).toBe(60000);
      expect(getEnv("ALLOWED_HOSTS")).toEqual(["a.test", "b.test"]);
      expect(getEnv("API_ORIGIN")).toBe("https://api.farm.test");
      expect(getEnv("PORT")).toBe(8080);
    });
  });
});
