// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { farmPlugin } from "../vite";
import {
  env,
  getEnv,
  getPublicEnv,
  getResolvedEnv,
  publicEnv,
  resolveEnv,
  serverEnv,
  setEnv,
} from "../env";

afterEach(() => {
  setEnv({ server: {}, public: {} });
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
});
