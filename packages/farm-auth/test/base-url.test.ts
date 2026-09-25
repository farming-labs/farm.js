import { describe, expect, it } from "vitest";
import { resolveFarmAuthBaseURL, resolveFarmAuthTrustedOrigins } from "../src/runtime.js";

describe("resolveFarmAuthBaseURL", () => {
  it("uses the canonical production domain on Vercel, not the deployment host", () => {
    // Better Auth trusts only the baseURL's origin, so pinning production to
    // the per-deployment hostname answered INVALID_ORIGIN for every request
    // that arrived on the real domain.
    expect(
      resolveFarmAuthBaseURL("production", {
        VERCEL_ENV: "production",
        VERCEL_URL: "my-app-a1b2c3.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "app.example.com",
      } as NodeJS.ProcessEnv),
    ).toBe("https://app.example.com");
  });

  it("keeps a preview deployment on its own hostname", () => {
    expect(
      resolveFarmAuthBaseURL("production", {
        VERCEL_ENV: "preview",
        VERCEL_URL: "my-app-preview.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "app.example.com",
      } as NodeJS.ProcessEnv),
    ).toBe("https://my-app-preview.vercel.app");
  });

  it("falls back to the deployment host when no canonical domain is exposed", () => {
    expect(
      resolveFarmAuthBaseURL("production", {
        VERCEL_ENV: "production",
        VERCEL_URL: "my-app-a1b2c3.vercel.app",
      } as NodeJS.ProcessEnv),
    ).toBe("https://my-app-a1b2c3.vercel.app");
  });

  it("lets an explicit URL win, and leaves a full URL untouched", () => {
    expect(
      resolveFarmAuthBaseURL("production", {
        FARM_AUTH_URL: "https://auth.example.com",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "app.example.com",
      } as NodeJS.ProcessEnv),
    ).toBe("https://auth.example.com");
    expect(
      resolveFarmAuthBaseURL("production", {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "https://app.example.com",
      } as NodeJS.ProcessEnv),
    ).toBe("https://app.example.com");
  });

  it("keeps the development default and stays undefined elsewhere", () => {
    expect(resolveFarmAuthBaseURL("development", {} as NodeJS.ProcessEnv)).toBe(
      "http://localhost:3000",
    );
    expect(resolveFarmAuthBaseURL("production", {} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("resolveFarmAuthTrustedOrigins", () => {
  it("keeps the deployment and branch hosts reachable beside the canonical domain", () => {
    expect(
      resolveFarmAuthTrustedOrigins({
        VERCEL_ENV: "production",
        VERCEL_URL: "my-app-a1b2c3.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "app.example.com",
        VERCEL_BRANCH_URL: "my-app-git-main.vercel.app",
      } as NodeJS.ProcessEnv),
    ).toEqual([
      "https://my-app-a1b2c3.vercel.app",
      "https://app.example.com",
      "https://my-app-git-main.vercel.app",
    ]);
  });

  it("is empty off Vercel", () => {
    expect(resolveFarmAuthTrustedOrigins({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});
