import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bot, type BotVerifyInput } from "../index";
import { hcaptcha, recaptcha, turnstile } from "./providers";
import { createSiteverifyProvider } from "./siteverify";

const REAL_SECRET = "0x4AAAAAAAreal-secret";
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const request = new Request("https://shop.example.com/signup", { method: "POST" });

function input(overrides: Partial<BotVerifyInput> = {}): BotVerifyInput {
  return {
    token: "token-1",
    form: undefined,
    request,
    remoteIp: undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();

function sentBody(): URLSearchParams {
  return fetchMock.mock.calls[0]![1]!.body as URLSearchParams;
}

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

const real = () => turnstile({ secretKey: REAL_SECRET, testKeys: false });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.stubEnv("TURNSTILE_SITE_KEY", "");
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createSiteverifyProvider", () => {
  it("posts the token and secret, and reports the hostname with the raw response", async () => {
    const answer = {
      success: true,
      hostname: "shop.example.com",
      challenge_ts: "2026-11-07T10:00:00Z",
      action: "signup",
    };
    respond(answer);
    const { signal } = new AbortController();

    expect(await real().verify(input({ remoteIp: "203.0.113.7", signal }))).toEqual({
      success: true,
      hostname: "shop.example.com",
      data: answer,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBe(signal);
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      secret: REAL_SECRET,
      response: "token-1",
      remoteip: "203.0.113.7",
    });
  });

  it("refuses a pass that names no hostname", async () => {
    respond({ success: true });
    expect(await real().verify(input())).toMatchObject({
      success: false,
      code: "hostname_mismatch",
    });
  });

  it("reports an expired or reused token", async () => {
    respond({ success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await real().verify(input())).toEqual({
      success: false,
      code: "expired",
      providerCodes: ["timeout-or-duplicate"],
    });
  });

  it("reports any other refusal as rejected", async () => {
    respond({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await real().verify(input())).toMatchObject({ success: false, code: "rejected" });
  });

  it("doesn't blame the visitor for the provider's own failure", async () => {
    for (const code of ["internal-error", "bad-request"]) {
      respond({ success: false, "error-codes": [code] });
      expect(await real().verify(input())).toMatchObject({ success: false, code: "unavailable" });
    }
  });

  it("throws when the provider rejects the secret key", async () => {
    respond({ success: false, "error-codes": ["invalid-input-secret"] });
    const error = await real()
      .verify(input())
      .catch((caught) => caught);
    expect(error.name).toBe("BotError");
    expect(error.code).toBe("invalid_secret_key");
    expect(error.message).toContain("TURNSTILE_SECRET_KEY");
  });

  it("fails closed when the provider errors, can't be reached, or answers junk", async () => {
    respond({}, 500);
    expect(await real().verify(input())).toMatchObject({
      success: false,
      code: "unavailable",
      providerCodes: ["http_500"],
    });

    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect(await real().verify(input())).toMatchObject({
      code: "unavailable",
      providerCodes: ["TimeoutError"],
    });

    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await real().verify(input())).toMatchObject({ success: false, code: "unavailable" });

    respond(null);
    expect(await real().verify(input())).toMatchObject({
      code: "unavailable",
      providerCodes: ["invalid_response"],
    });
  });

  it("reads the reason from a non-2xx answer, because Turnstile sends a wrong secret as 400", async () => {
    respond({ success: false, "error-codes": ["invalid-input-secret"] }, 400);
    await expect(real().verify(input())).rejects.toMatchObject({ code: "invalid_secret_key" });
  });

  it("never passes a non-2xx answer, whatever its body claims", async () => {
    respond({ success: true, hostname: "shop.example.com", "error-codes": ["odd"] }, 500);
    expect(await real().verify(input())).toMatchObject({ success: false, code: "rejected" });
    respond({ success: true, hostname: "shop.example.com" }, 500);
    expect(await real().verify(input())).toMatchObject({ success: false, code: "unavailable" });
  });

  it("reads the secret from runtime bindings first, as on Cloudflare Workers", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAfrom-env");
    vi.stubGlobal("__env__", { TURNSTILE_SECRET_KEY: "0x4AAAAAAAfrom-binding" });
    respond({ success: true, hostname: "shop.example.com" });
    await turnstile({ testKeys: false }).verify(input());
    expect(sentBody().get("secret")).toBe("0x4AAAAAAAfrom-binding");
  });

  it.each(["", "staging", "production"])(
    "never falls back to test keys when NODE_ENV is %j, as on a deployed worker",
    async (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      await expect(turnstile().verify(input())).rejects.toMatchObject({
        code: "missing_secret_key",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uses the test site key while `farm dev` hasn't set NODE_ENV yet, but not in a build", () => {
    vi.stubEnv("NODE_ENV", "");
    expect(turnstile().client!().public).toMatchObject({ siteKey: "1x00000000000000000000AA" });

    vi.stubEnv("NODE_ENV", "production");
    expect(() => turnstile().client!()).toThrow(/TURNSTILE_SITE_KEY/);
  });

  it("refuses a test secret when NODE_ENV is unset", async () => {
    vi.stubEnv("NODE_ENV", "");
    vi.stubGlobal("__env__", { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET });
    await expect(turnstile().verify(input())).rejects.toMatchObject({
      code: "test_key_in_production",
    });
  });

  it("reads the secret from the environment on every call", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAfrom-env");
    respond({ success: true, hostname: "shop.example.com" });
    await turnstile({ testKeys: false }).verify(input());
    expect(sentBody().get("secret")).toBe("0x4AAAAAAAfrom-env");
  });

  it("throws when the secret is missing and test keys are off", async () => {
    await expect(turnstile({ testKeys: false }).verify(input())).rejects.toMatchObject({
      code: "missing_secret_key",
      message: expect.stringContaining("TURNSTILE_SECRET_KEY"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns test keys off in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(turnstile().verify(input())).rejects.toMatchObject({
      code: "missing_secret_key",
    });
  });

  it("refuses the provider's test secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const secretKey of [
      TURNSTILE_TEST_SECRET,
      "2x0000000000000000000000000000000AA",
      "3x0000000000000000000000000000000AA",
    ]) {
      await expect(turnstile({ secretKey }).verify(input())).rejects.toMatchObject({
        code: "test_key_in_production",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the test secret, and skips the hostname check, on test keys", async () => {
    respond({ success: true, hostname: "example.com" });
    expect(await turnstile().verify(input())).toMatchObject({ success: true, testKeys: true });
    expect(sentBody().get("secret")).toBe(TURNSTILE_TEST_SECRET);
  });

  it("allows test keys in production only when asked", async () => {
    vi.stubEnv("NODE_ENV", "production");
    respond({ success: true, hostname: "example.com" });
    expect(await turnstile({ testKeys: true }).verify(input())).toMatchObject({
      success: true,
      testKeys: true,
    });
  });

  it("reports every key mistake in a provider's options", () => {
    expect(() => turnstile({ siteKey: " " })).toThrow(/siteKey/);
    expect(() => turnstile({ secretKey: "" })).toThrow(/secretKey/);
    expect(() => turnstile({ testKeys: "yes" as never })).toThrow(/testKeys/);
  });

  it("needs real keys in development when a provider has no test keys", async () => {
    const provider = createSiteverifyProvider({
      name: "acme",
      tokenField: "acme-response",
      verifyUrl: "https://api.acme.example/siteverify",
      widget: { scriptUrl: "https://js.acme.example/api.js", global: "acme" },
      siteKeyEnv: "ACME_SITE_KEY",
      secretKeyEnv: "ACME_SECRET_KEY",
      csp: { "script-src": ["https://js.acme.example"] },
    });
    expect(() => provider.client!()).toThrow(/ACME_SITE_KEY/);
    await expect(provider.verify(input())).rejects.toMatchObject({ code: "missing_secret_key" });
  });
});

describe("hCaptcha", () => {
  const provider = () => hcaptcha({ secretKey: "0xreal", testKeys: false });

  it("uses its own field and verify URL", async () => {
    respond({ success: true, hostname: "shop.example.com" });
    await provider().verify(input());
    expect(provider().tokenField).toBe("h-captcha-response");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.hcaptcha.com/siteverify");
  });

  it("maps its own expired and secret codes", async () => {
    for (const code of ["expired-input-response", "already-seen-response"]) {
      respond({ success: false, "error-codes": [code] });
      expect(await provider().verify(input())).toMatchObject({ code: "expired" });
    }
  });

  it("doesn't let a visitor's token raise a false wrong-secret alarm", async () => {
    // A visitor can send the public dummy token, or a token from another site's key.
    for (const code of [
      "not-using-dummy-secret",
      "not-using-dummy-passcode",
      "sitekey-secret-mismatch",
    ]) {
      respond({ success: false, "error-codes": [code] });
      expect(await provider().verify(input())).toMatchObject({ success: false, code: "rejected" });
    }
  });

  it("doesn't refuse visitors when hCaptcha can't report the hostname", async () => {
    respond({ success: true, hostname: "not-provided" });
    expect(await provider().verify(input())).toMatchObject({ success: true });
    respond({ success: true, hostname: "not-provided" });
    expect((await provider().verify(input())).success && "hostname").toBe("hostname");
  });

  it("accepts a token longer than Turnstile's limit", async () => {
    respond({ success: true, hostname: "shop.example.com" });
    const plugin = bot({ provider: provider() });
    expect((await plugin.verify("x".repeat(4000), { request })).success).toBe(true);
  });
});

describe("Turnstile", () => {
  it("refuses a token over its documented limit without calling the provider", async () => {
    const plugin = bot({ provider: real() });
    expect(await plugin.verify("x".repeat(2049), { request })).toMatchObject({ code: "rejected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reCAPTCHA", () => {
  it("uses its own field and verify URL, and waits for its ready callback", async () => {
    respond({ success: true, hostname: "shop.example.com" });
    const provider = recaptcha({ siteKey: "public", secretKey: "real", testKeys: false });
    await provider.verify(input());
    expect(provider.tokenField).toBe("g-recaptcha-response");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://www.google.com/recaptcha/api/siteverify");
    expect(provider.client!().public).toMatchObject({ global: "grecaptcha", readyCallback: true });
  });
});
