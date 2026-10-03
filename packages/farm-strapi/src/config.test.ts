import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveStrapiConfig } from "./config.js";

const VARS = ["STRAPI_API_URL", "STRAPI_MEDIA_URL", "STRAPI_API_TOKEN", "STRAPI_WEBHOOK_SECRET"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
  for (const name of VARS) delete process.env[name];
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("resolveStrapiConfig", () => {
  it("reads the Content API URL and token from the environment", () => {
    process.env.STRAPI_API_URL = "https://cms.example.com/api";
    process.env.STRAPI_API_TOKEN = "read-token";

    expect(resolveStrapiConfig({})).toEqual({
      apiUrl: "https://cms.example.com/api",
      mediaUrl: "https://cms.example.com",
      token: "read-token",
      webhookSecret: undefined,
    });
  });

  it("uses a separate public media origin", () => {
    const config = resolveStrapiConfig({
      apiUrl: "https://cms.example.com/api/",
      mediaUrl: "https://media.example.com/",
    });

    expect(config.apiUrl).toBe("https://cms.example.com/api");
    expect(config.mediaUrl).toBe("https://media.example.com");
  });

  it("prefers explicit values over the environment", () => {
    process.env.STRAPI_API_URL = "https://env.example.com/api";
    process.env.STRAPI_API_TOKEN = "env-token";

    const config = resolveStrapiConfig({
      apiUrl: "https://input.example.com/api",
      token: "input-token",
    });

    expect(config.apiUrl).toBe("https://input.example.com/api");
    expect(config.token).toBe("input-token");
  });

  it("reads the webhook secret from the environment", () => {
    process.env.STRAPI_WEBHOOK_SECRET = "webhook-secret";

    expect(resolveStrapiConfig({}).webhookSecret).toBe("webhook-secret");
  });

  it("rejects relative and non-http URLs", () => {
    expect(() => resolveStrapiConfig({ apiUrl: "/api" })).toThrow(/absolute HTTP or HTTPS/);
    expect(() => resolveStrapiConfig({ apiUrl: "file:///tmp/strapi" })).toThrow(/HTTP or HTTPS/);
  });

  it("returns empty required values when they are absent", () => {
    expect(resolveStrapiConfig({})).toEqual({
      apiUrl: "",
      mediaUrl: "",
      token: undefined,
      webhookSecret: undefined,
    });
  });
});
