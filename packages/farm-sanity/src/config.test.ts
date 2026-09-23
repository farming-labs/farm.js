import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SANITY_API_VERSION, resolveSanityConfig } from "./config.js";

const SANITY_VARS = [
  "SANITY_PROJECT_ID",
  "SANITY_STUDIO_PROJECT_ID",
  "SANITY_DATASET",
  "SANITY_STUDIO_DATASET",
  "SANITY_API_VERSION",
  "SANITY_STUDIO_API_VERSION",
  "SANITY_API_READ_TOKEN",
  "SANITY_WEBHOOK_SECRET",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(SANITY_VARS.map((name) => [name, process.env[name]]));
  for (const name of SANITY_VARS) delete process.env[name];
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("resolveSanityConfig", () => {
  it("reads projectId and dataset from the environment", () => {
    process.env.SANITY_PROJECT_ID = "from-env";
    process.env.SANITY_DATASET = "production";

    expect(resolveSanityConfig({})).toEqual({
      projectId: "from-env",
      dataset: "production",
      apiVersion: DEFAULT_SANITY_API_VERSION,
      useCdn: true,
      token: undefined,
      webhookSecret: undefined,
    });
  });

  it("enables the CDN unless told otherwise", () => {
    expect(resolveSanityConfig({}).useCdn).toBe(true);
    expect(resolveSanityConfig({ useCdn: false }).useCdn).toBe(false);
  });

  it("reads the webhook secret from SANITY_WEBHOOK_SECRET", () => {
    process.env.SANITY_WEBHOOK_SECRET = "whsec_env";

    expect(resolveSanityConfig({}).webhookSecret).toBe("whsec_env");
  });

  it("prefers a webhook secret passed in input", () => {
    process.env.SANITY_WEBHOOK_SECRET = "whsec_env";

    const config = resolveSanityConfig({
      webhook: { secret: "whsec_input", onChange: () => undefined },
    });

    expect(config.webhookSecret).toBe("whsec_input");
  });

  it("prefers explicit input over the environment", () => {
    process.env.SANITY_PROJECT_ID = "from-env";
    process.env.SANITY_DATASET = "from-env";

    const config = resolveSanityConfig({ projectId: "explicit", dataset: "staging" });

    expect(config.projectId).toBe("explicit");
    expect(config.dataset).toBe("staging");
  });

  it("falls back to the SANITY_STUDIO_ variables", () => {
    process.env.SANITY_STUDIO_PROJECT_ID = "studio-project";
    process.env.SANITY_STUDIO_DATASET = "studio-dataset";

    const config = resolveSanityConfig({});

    expect(config.projectId).toBe("studio-project");
    expect(config.dataset).toBe("studio-dataset");
  });

  it("prefers the unprefixed variable over the studio one", () => {
    process.env.SANITY_PROJECT_ID = "primary";
    process.env.SANITY_STUDIO_PROJECT_ID = "studio";

    expect(resolveSanityConfig({}).projectId).toBe("primary");
  });

  it("treats an empty variable as missing", () => {
    process.env.SANITY_PROJECT_ID = "";
    process.env.SANITY_STUDIO_PROJECT_ID = "studio";

    expect(resolveSanityConfig({}).projectId).toBe("studio");
  });

  it("defaults apiVersion so the resolved type is honest", () => {
    expect(resolveSanityConfig({}).apiVersion).toBe(DEFAULT_SANITY_API_VERSION);
  });

  it("reads the token only from SANITY_API_READ_TOKEN", () => {
    process.env.SANITY_API_READ_TOKEN = "sk-test";

    expect(resolveSanityConfig({}).token).toBe("sk-test");
  });

  it("leaves the token undefined when nothing supplies it", () => {
    expect(resolveSanityConfig({}).token).toBeUndefined();
  });

  it("returns empty strings when required values are absent", () => {
    const config = resolveSanityConfig({});

    expect(config.projectId).toBe("");
    expect(config.dataset).toBe("");
  });
});
