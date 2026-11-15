import { bot } from "../index";
import { checkBotProvider } from "../testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hcaptcha, recaptcha, turnstile } from "./index";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] })),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each([
  ["turnstile", turnstile, "cf-turnstile-response"],
  ["hcaptcha", hcaptcha, "h-captcha-response"],
  ["recaptcha", recaptcha, "g-recaptcha-response"],
] as const)("%s", (name, provider, tokenField) => {
  it("meets the provider contract", async () => {
    expect(
      await checkBotProvider(provider({ secretKey: "real-secret" }), { secrets: ["real-secret"] }),
    ).toEqual([]);
  });

  it("plugs into bot() and uses this package's widget", () => {
    expect(bot({ provider: provider({ siteKey: "site" }) }).client!.public).toEqual({
      widget: "@farm.js/bot/captcha/widget",
      tokenField,
      config: expect.objectContaining({ name, siteKey: "site" }),
    });
  });
});

it("names a widget path the package really exports", async () => {
  const manifest = (await import("../../package.json")) as { exports: Record<string, unknown> };
  expect(manifest.exports).toHaveProperty(["./captcha/widget"]);
  expect(manifest.exports).toHaveProperty(["./captcha"]);
});

describe("the sources each vendor's browser code needs", () => {
  it("covers Turnstile", () => {
    const origin = ["https://challenges.cloudflare.com"];
    expect(turnstile().csp).toEqual({ "script-src": origin, "frame-src": origin });
  });

  it("covers hCaptcha, including its styles and connections", () => {
    const sources = ["https://hcaptcha.com", "https://*.hcaptcha.com"];
    expect(hcaptcha().csp).toEqual({
      "script-src": sources,
      "frame-src": sources,
      "style-src": sources,
      "connect-src": sources,
    });
  });

  it("covers reCAPTCHA, on the paths Google documents", () => {
    expect(recaptcha().csp).toEqual({
      "script-src": ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
      "frame-src": ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"],
      "connect-src": ["https://www.google.com/recaptcha/"],
    });
  });
});
