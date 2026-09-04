// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  normalizeFarmAPIConfig,
  resolveFarmAPIConfig,
  resolveFarmAPIRequestURL,
} from "../api/config";
import {
  resolveFarmAPICanonicalPathname,
  resolveFarmAPIServerBasePath,
  resolveFarmAPIServerRoutePath,
} from "../api/server-path";

const context = {
  root: "/workspace/app",
  mode: "production" as const,
  env: {
    server: { API_INTERNAL_HOST: "api.internal" },
    public: { API_ORIGIN: "https://api.example.com" },
  },
};

describe("Farm API config", () => {
  it("defaults to the same-origin /api root", async () => {
    await expect(resolveFarmAPIConfig(undefined, context)).resolves.toEqual({
      baseURL: "/api",
      basePath: "/api",
    });
  });

  it("joins an origin-only baseURL with basePath", async () => {
    await expect(
      resolveFarmAPIConfig(
        {
          baseURL: "https://api.example.com/",
          basePath: "v2/api/",
        },
        context,
      ),
    ).resolves.toEqual({
      baseURL: "https://api.example.com/v2/api",
      basePath: "/v2/api",
    });
  });

  it("uses a baseURL path instead of appending basePath", async () => {
    await expect(
      resolveFarmAPIConfig(
        {
          baseURL: "https://api.example.com/gateway/v1/",
          basePath: "/ignored",
        },
        context,
      ),
    ).resolves.toEqual({
      baseURL: "https://api.example.com/gateway/v1",
      basePath: "/gateway/v1",
    });
  });

  it("resolves sync and async config functions with context", async () => {
    const baseURL = vi.fn(({ env }: typeof context) => env.public.API_ORIGIN as string);
    const basePath = vi.fn(async ({ mode }: typeof context) =>
      mode === "production" ? "/v1" : "/api",
    );

    await expect(resolveFarmAPIConfig({ baseURL, basePath }, context)).resolves.toEqual({
      baseURL: "https://api.example.com/v1",
      basePath: "/v1",
    });
    expect(baseURL).toHaveBeenCalledWith(context);
    expect(basePath).toHaveBeenCalledWith(context);
  });

  it("rejects invalid base URLs and paths", () => {
    expect(() => normalizeFarmAPIConfig({ baseURL: "api.example.com" })).toThrow(
      "absolute URL or a root-relative path",
    );
    expect(() => normalizeFarmAPIConfig({ basePath: "/api?version=1" })).toThrow(
      "cannot contain a query string or hash",
    );
    expect(() => normalizeFarmAPIConfig({ basePath: "/api\\admin" })).toThrow(
      "cannot contain backslashes or control characters",
    );
    expect(() => normalizeFarmAPIConfig({ basePath: "/api/../admin" })).toThrow(
      'cannot contain "." or ".." path segments',
    );
    expect(() => normalizeFarmAPIConfig({ basePath: "/api/%2e%2e/admin" })).toThrow(
      'cannot contain "." or ".." path segments',
    );
  });

  it("replaces the canonical /api prefix when the API root has a path", () => {
    expect(
      resolveFarmAPIRequestURL("/api/users?limit=5", "https://api.example.com/gateway/v1").href,
    ).toBe("https://api.example.com/gateway/v1/users?limit=5");
  });

  it("preserves canonical routes for an origin-only explicit baseURL", () => {
    expect(resolveFarmAPIRequestURL("/api/users", "https://api.example.com").href).toBe(
      "https://api.example.com/api/users",
    );
  });

  it("mounts root-relative API roots locally and leaves external origins at /api", () => {
    expect(resolveFarmAPIServerBasePath({ baseURL: "/v2/api", basePath: "/v2/api" })).toBe(
      "/v2/api",
    );
    expect(
      resolveFarmAPIServerBasePath({
        baseURL: "https://api.example.com/v2/api",
        basePath: "/v2/api",
      }),
    ).toBe("/api");
  });

  it("translates between a local public API root and canonical route paths", () => {
    expect(resolveFarmAPICanonicalPathname("/v2/api/users/42", "/v2/api")).toBe("/api/users/42");
    expect(resolveFarmAPIServerRoutePath("/api/users/[id]", "/v2/api")).toBe("/v2/api/users/[id]");
    expect(resolveFarmAPICanonicalPathname("/about", "/v2/api")).toBe("/about");
  });
});
