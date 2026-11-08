import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotError } from "./errors";
import type { BotProvider, BotVerdict, BotVerifyInput } from "./provider";
import { verifyBotCheck, type BotCheckVerifySettings } from "./verify";

const currentRequest = vi.hoisted(() => ({ value: undefined as Request | undefined }));
vi.mock("@farm.js/core/request", () => ({
  getCurrentRequest() {
    if (!currentRequest.value) throw new Error("No current request is available.");
    return currentRequest.value;
  },
}));

const request = new Request("https://shop.example.com/signup", { method: "POST" });

function fakeProvider(
  verdict: BotVerdict<{ score: number }> | (() => Promise<BotVerdict<{ score: number }>>),
  extra: Partial<Omit<BotProvider<{ score: number }>, "verify">> = {},
) {
  const verify = vi.fn(async (_input: BotVerifyInput) =>
    typeof verdict === "function" ? verdict() : verdict,
  );
  return { name: "acme", tokenField: "acme-token", verify, ...extra };
}

function settings(
  provider: BotProvider<{ score: number }>,
  overrides: Partial<BotCheckVerifySettings<{ score: number }>> = {},
): BotCheckVerifySettings<{ score: number }> {
  return { provider, hostnames: undefined, timeoutMs: 5000, ...overrides };
}

function form(token: string | undefined, field = "acme-token"): FormData {
  const data = new FormData();
  data.set("email", "ada@example.com");
  if (token !== undefined) data.set(field, token);
  return data;
}

beforeEach(() => {
  currentRequest.value = undefined;
});

describe("verifyBotCheck", () => {
  it("hands the provider the token, form, request, IP, and a signal", async () => {
    const provider = fakeProvider({ success: true, data: { score: 0.9 } });
    const submitted = form("token-1");

    const result = await verifyBotCheck(settings(provider), submitted, {
      request,
      remoteIp: "203.0.113.7",
    });

    expect(result).toEqual({
      success: true,
      provider: "acme",
      hostname: undefined,
      testKeys: false,
      data: { score: 0.9 },
    });
    const input = provider.verify.mock.calls[0]![0];
    expect(input).toMatchObject({ token: "token-1", request, remoteIp: "203.0.113.7" });
    expect(input.form).toBe(submitted);
    expect(input.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts a raw token string, for JSON APIs", async () => {
    const provider = fakeProvider({ success: true });
    await verifyBotCheck(settings(provider), "token-json", { request });
    expect(provider.verify.mock.calls[0]![0]).toMatchObject({
      token: "token-json",
      form: undefined,
    });
  });

  it("refuses a missing token without calling the provider", async () => {
    const provider = fakeProvider({ success: true });
    for (const input of [form(undefined), form(""), null, undefined, ""]) {
      expect(await verifyBotCheck(settings(provider), input, { request })).toMatchObject({
        success: false,
        code: "missing_token",
        status: 403,
      });
    }
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it("ignores a token sent under another field or as a file", async () => {
    const provider = fakeProvider({ success: true });
    const wrongField = form("token-1", "other-field");
    const asFile = new FormData();
    asFile.set("acme-token", new File(["token"], "token.txt"));
    for (const input of [wrongField, asFile]) {
      expect(await verifyBotCheck(settings(provider), input, { request })).toMatchObject({
        code: "missing_token",
      });
    }
  });

  it("refuses a token over the provider's limit without calling it", async () => {
    const provider = fakeProvider({ success: true }, { maxTokenLength: 10 });
    expect(await verifyBotCheck(settings(provider), "x".repeat(11), { request })).toMatchObject({
      code: "rejected",
    });
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it("calls a provider with no token field even when nothing was sent", async () => {
    const provider = fakeProvider({ success: true }, { tokenField: undefined });
    expect((await verifyBotCheck(settings(provider), undefined, { request })).success).toBe(true);
    expect(provider.verify.mock.calls[0]![0]).toMatchObject({ token: undefined, request });
  });

  it("turns a refusal into a status and a message the visitor can read", async () => {
    const provider = fakeProvider({
      success: false,
      code: "expired",
      providerCodes: ["vendor-code"],
    });
    expect(await verifyBotCheck(settings(provider), "token", { request })).toEqual({
      success: false,
      provider: "acme",
      code: "expired",
      message: "The bot check expired. Complete it again, then send the form again.",
      status: 403,
      providerCodes: ["vendor-code"],
    });
  });

  it("answers 503 when the provider is unavailable", async () => {
    const provider = fakeProvider({ success: false, code: "unavailable" });
    expect(await verifyBotCheck(settings(provider), "token", { request })).toMatchObject({
      status: 503,
    });
  });

  it("treats an unknown failure code as a refusal", async () => {
    const provider = fakeProvider({ success: false, code: "made_up" as never });
    expect(await verifyBotCheck(settings(provider), "token", { request })).toMatchObject({
      success: false,
      code: "rejected",
    });
  });

  it("fails closed when a provider returns something that isn't a verdict", async () => {
    for (const bad of [undefined, null, {}, { success: "true" }, { success: 1 }]) {
      const provider = fakeProvider(bad as never);
      await expect(verifyBotCheck(settings(provider), "token", { request })).rejects.toMatchObject({
        name: "BotError",
        code: "invalid_provider",
      });
    }
  });

  it("refuses a check solved on another site", async () => {
    const provider = fakeProvider({ success: true, hostname: "evil.example.net" });
    expect(await verifyBotCheck(settings(provider), "token", { request })).toMatchObject({
      success: false,
      code: "hostname_mismatch",
      status: 403,
    });
  });

  it("compares hostnames without regard to case", async () => {
    const provider = fakeProvider({ success: true, hostname: "SHOP.example.com" });
    expect(await verifyBotCheck(settings(provider), "token", { request })).toMatchObject({
      success: true,
      hostname: "shop.example.com",
    });
  });

  it("checks configured hostnames instead of the request", async () => {
    const provider = fakeProvider({ success: true, hostname: "www.example.com" });
    const result = await verifyBotCheck(
      settings(provider, { hostnames: ["example.com", "WWW.example.com"] }),
      "token",
    );
    expect(result.success).toBe(true);
  });

  it("reads the current request when none is passed", async () => {
    currentRequest.value = request;
    const provider = fakeProvider({ success: true, hostname: "shop.example.com" });
    expect((await verifyBotCheck(settings(provider), "token")).success).toBe(true);
    expect(provider.verify.mock.calls[0]![0].request).toBe(request);
  });

  it("fails closed on a hostname that isn't a string", async () => {
    for (const hostname of [null, 123, {}]) {
      const provider = fakeProvider({ success: true, hostname: hostname as never });
      await expect(
        verifyBotCheck(settings(provider, { hostnames: ["shop.example.com"] }), "token", {
          request,
        }),
      ).rejects.toMatchObject({ name: "BotError", code: "invalid_provider" });
    }
  });

  it("treats non-form input from a JSON body as no token", async () => {
    const provider = fakeProvider({ success: true });
    for (const input of [{}, 7, ["t"], true]) {
      expect(await verifyBotCheck(settings(provider), input as never, { request })).toMatchObject({
        success: false,
        code: "missing_token",
      });
    }
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it("throws when it can't tell which hostname to expect", async () => {
    const provider = fakeProvider({ success: true, hostname: "shop.example.com" });
    await expect(verifyBotCheck(settings(provider), "token")).rejects.toMatchObject({
      name: "BotError",
      code: "missing_request",
    });
  });

  it("doesn't need a request for a provider that reports no hostname", async () => {
    const provider = fakeProvider({ success: true });
    expect((await verifyBotCheck(settings(provider), "token")).success).toBe(true);
  });

  it("refuses the submission when a provider ignores its timeout", async () => {
    const provider = fakeProvider(() => new Promise(() => {}));
    expect(
      await verifyBotCheck(settings(provider, { timeoutMs: 5 }), "token", { request }),
    ).toMatchObject({
      success: false,
      code: "unavailable",
      status: 503,
      providerCodes: ["timeout"],
    });
  });

  it("passes a provider's own error through instead of hiding it", async () => {
    const error = new BotError("missing_secret_key", "Set the key.");
    const provider = fakeProvider(() => Promise.reject(error));
    await expect(verifyBotCheck(settings(provider), "token", { request })).rejects.toBe(error);
  });

  it("passes through a provider that throws synchronously", async () => {
    const provider = fakeProvider({ success: true });
    provider.verify.mockImplementation(() => {
      throw new TypeError("broken provider");
    });
    await expect(verifyBotCheck(settings(provider), "token", { request })).rejects.toThrow(
      "broken provider",
    );
  });
});
