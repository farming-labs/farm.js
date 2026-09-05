import type { SanityClient } from "@sanity/client";
import { describe, expect, it } from "vitest";
import { createFreshSanityClient, createSanityClient } from "./client.js";
import type { ResolvedSanityConfig } from "./config.js";

const config: ResolvedSanityConfig = {
  projectId: "test-project",
  dataset: "production",
  apiVersion: "2026-03-01",
  useCdn: true,
};

describe("createSanityClient", () => {
  it("builds a client from the resolved config", () => {
    const client = createSanityClient(config);
    const applied = client.config();

    expect(applied.projectId).toBe("test-project");
    expect(applied.dataset).toBe("production");
    expect(applied.apiVersion).toBe("2026-03-01");
  });

  it("applies the configured useCdn", () => {
    expect(createSanityClient(config).config().useCdn).toBe(true);
    expect(createSanityClient({ ...config, useCdn: false }).config().useCdn).toBe(false);
  });

  it("passes the token through under the name Sanity expects", () => {
    const client = createSanityClient({ ...config, token: "sk-test" });

    expect(client.config().token).toBe("sk-test");
  });

  it("omits the token when none is configured", () => {
    expect(createSanityClient(config).config().token).toBeUndefined();
  });

  it("returns a supplied instance instead of constructing one", () => {
    const instance = { marker: "supplied" } as unknown as SanityClient;

    expect(createSanityClient(config, instance)).toBe(instance);
  });

  it("does not forward the webhook secret to the Sanity client", () => {
    const applied = createSanityClient({
      ...config,
      webhookSecret: "should-not-leak",
    }).config() as Record<string, unknown>;

    expect(applied.webhookSecret).toBeUndefined();
  });
});

describe("createFreshSanityClient", () => {
  it("disables the CDN", () => {
    const fresh = createFreshSanityClient(createSanityClient(config));

    expect(fresh.config().useCdn).toBe(false);
  });

  it("leaves the original client untouched", () => {
    const base = createSanityClient(config);
    createFreshSanityClient(base);

    expect(base.config().useCdn).toBe(true);
  });

  it("keeps the project settings", () => {
    const fresh = createFreshSanityClient(createSanityClient(config));

    expect(fresh.config().projectId).toBe("test-project");
    expect(fresh.config().dataset).toBe("production");
  });
});
