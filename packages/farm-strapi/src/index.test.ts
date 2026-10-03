import type { StrapiClient } from "@strapi/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STRAPI_WEBHOOK_PATH, strapi } from "./index.js";

const VARS = ["STRAPI_API_URL", "STRAPI_WEBHOOK_SECRET"];
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

function validate(integration: ReturnType<typeof strapi>) {
  const definition = integration.config as {
    schema: { safeParse(value: unknown): { success: boolean; error?: { issues: unknown[] } } };
    input: unknown;
  };
  return definition.schema.safeParse(definition.input);
}

describe("strapi()", () => {
  it("declares itself as a cms integration", () => {
    const integration = strapi({ apiUrl: "https://cms.example.com/api" });

    expect(integration.kind).toBe("farm-integration");
    expect(integration.category).toBe("cms");
    expect(integration.type).toBe("strapi");
  });

  it("exposes the official client as the integration instance", () => {
    const integration = strapi({ apiUrl: "https://cms.example.com/api" });

    expect(integration.instance.baseURL).toBe("https://cms.example.com/api");
  });

  it("uses a supplied client without requiring a URL", () => {
    const instance = { marker: "supplied" } as unknown as StrapiClient;

    expect(strapi({ instance }).instance).toBe(instance);
    expect(validate(strapi({ instance })).success).toBe(true);
  });

  it("registers a configured webhook route", () => {
    const integration = strapi({
      apiUrl: "https://cms.example.com/api",
      webhook: { secret: "secret", onChange: () => undefined },
    });

    expect(integration.routes).toHaveLength(1);
    expect(integration.routes?.[0].path).toBe(DEFAULT_STRAPI_WEBHOOK_PATH);
  });

  it("reports a missing URL before constructing the client", () => {
    expect(() => strapi()).toThrow(/STRAPI_API_URL/);
  });

  it("requires a secret when a webhook is enabled", () => {
    const result = validate(
      strapi({
        apiUrl: "https://cms.example.com/api",
        webhook: { onChange: () => undefined },
      }),
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("webhookSecret");
  });
});
