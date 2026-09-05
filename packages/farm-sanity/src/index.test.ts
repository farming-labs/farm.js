import type { SanityClient } from "@sanity/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SANITY_WEBHOOK_PATH, sanity } from "./index.js";

const VARS = ["SANITY_PROJECT_ID", "SANITY_DATASET", "SANITY_WEBHOOK_SECRET"];
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

function validate(integration: ReturnType<typeof sanity>) {
  const definition = integration.config as {
    schema: { safeParse(value: unknown): { success: boolean; error?: { issues: unknown[] } } };
    input: unknown;
  };
  return definition.schema.safeParse(definition.input);
}

describe("sanity()", () => {
  it("declares itself as a cms integration", () => {
    const integration = sanity({ projectId: "p", dataset: "d" });

    expect(integration.kind).toBe("farm-integration");
    expect(integration.category).toBe("cms");
    expect(integration.type).toBe("sanity");
  });

  it("exposes the constructed client as the instance", () => {
    const integration = sanity({ projectId: "p", dataset: "d", apiVersion: "2026-01-01" });

    expect(integration.instance.config().projectId).toBe("p");
    expect(integration.instance.config().apiVersion).toBe("2026-01-01");
  });

  it("uses a supplied client as the instance", () => {
    const instance = { marker: "supplied" } as unknown as SanityClient;

    expect(sanity({ instance }).instance).toBe(instance);
  });

  it("registers no routes without a webhook", () => {
    expect(sanity({ projectId: "p", dataset: "d" }).routes ?? []).toEqual([]);
  });

  it("registers the webhook route when a webhook and secret are configured", () => {
    const integration = sanity({
      projectId: "p",
      dataset: "d",
      webhook: { secret: "whsec", onChange: () => undefined },
    });

    expect(integration.routes).toHaveLength(1);
    expect(integration.routes?.[0].path).toBe(DEFAULT_SANITY_WEBHOOK_PATH);
    expect(integration.routes?.[0].method).toBe("POST");
  });

  it("reads the webhook secret from the environment", () => {
    process.env.SANITY_WEBHOOK_SECRET = "whsec_env";

    const integration = sanity({
      projectId: "p",
      dataset: "d",
      webhook: { onChange: () => undefined },
    });

    expect(integration.routes).toHaveLength(1);
  });

  it("does not register the route when the webhook has no secret", () => {
    const integration = sanity({
      projectId: "p",
      dataset: "d",
      webhook: { onChange: () => undefined },
    });

    expect(integration.routes ?? []).toEqual([]);
  });

  describe("startup validation", () => {
    it("passes with a project and dataset", () => {
      expect(validate(sanity({ projectId: "p", dataset: "d" })).success).toBe(true);
    });

    it("fails clearly without a project or dataset", () => {
      // The client cannot be built without these, and the factory runs before
      // Farm validates config, so this is the earliest point that can report it.
      expect(() => sanity()).toThrow(/SANITY_PROJECT_ID/);
    });

    it("does not require credentials when a client is supplied", () => {
      const instance = {} as SanityClient;

      expect(validate(sanity({ instance })).success).toBe(true);
    });

    it("requires a secret once a webhook is configured", () => {
      const result = validate(
        sanity({ projectId: "p", dataset: "d", webhook: { onChange: () => undefined } }),
      );

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("webhookSecret");
    });
  });
});
