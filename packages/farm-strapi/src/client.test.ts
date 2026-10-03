import type { StrapiClient } from "@strapi/client";
import { describe, expect, it } from "vitest";
import { createStrapiClient } from "./client.js";
import type { ResolvedStrapiConfig } from "./config.js";

const config: ResolvedStrapiConfig = {
  apiUrl: "https://cms.example.com/api",
  mediaUrl: "https://media.example.com",
  token: "read-token",
  webhookSecret: "webhook-secret",
};

describe("createStrapiClient", () => {
  it("builds the official client from the Content API URL", () => {
    expect(createStrapiClient(config).baseURL).toBe("https://cms.example.com/api");
  });

  it("returns a supplied instance instead of constructing one", () => {
    const instance = { marker: "supplied" } as unknown as StrapiClient;

    expect(createStrapiClient(config, instance)).toBe(instance);
  });

  it("rejects a missing API URL before calling the provider SDK", () => {
    expect(() => createStrapiClient({ ...config, apiUrl: "" })).toThrow(/without an API URL/);
  });

  it("does not expose integration-only values on the client", () => {
    const client = createStrapiClient(config) as unknown as Record<string, unknown>;

    expect(client.mediaUrl).toBeUndefined();
    expect(client.webhookSecret).toBeUndefined();
  });
});
