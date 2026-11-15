import { afterEach, describe, expect, it, vi } from "vitest";
import { bot, defineBotProvider } from "./index";
import { verifyBot } from "./server";

const runtimeKey = Symbol.for("@farm.js/bot/runtime");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[runtimeKey];
});

const accepts = (token: string) =>
  defineBotProvider({
    name: "accepts",
    tokenField: "field",
    verify: async (input) =>
      input.token === token
        ? { success: true as const, data: { token: input.token } }
        : { success: false as const, code: "rejected" as const },
  });

describe("verifyBot", () => {
  it("checks with the options given to bot() in farm.config.ts", async () => {
    bot({ provider: accepts("good") });
    const form = new FormData();
    form.set("field", "good");

    expect(await verifyBot(form)).toMatchObject({ success: true, provider: "accepts" });
    expect(await verifyBot("bad")).toMatchObject({ success: false, code: "rejected" });
  });

  it("applies the plugin's other options", async () => {
    const provider = defineBotProvider({
      name: "reports-host",
      verify: async () => ({ success: true as const, hostname: "other.example.com" }),
    });
    bot({ provider, hostnames: ["shop.example.com"] });
    expect(await verifyBot(null)).toMatchObject({ code: "hostname_mismatch" });
  });

  it("passes the request through to the provider", async () => {
    const verify = vi.fn(async () => ({ success: false as const, code: "rejected" as const }));
    bot({ provider: { name: "reads-request", verify } });
    const request = new Request("https://shop.example.com/");

    await verifyBot(null, { request, remoteIp: "203.0.113.7" });
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ request, remoteIp: "203.0.113.7" }),
    );
  });

  it("says what to add when the plugin isn't configured", async () => {
    await expect(verifyBot("token")).rejects.toMatchObject({
      name: "BotError",
      code: "missing_plugin",
      message: expect.stringContaining("farm.config.ts"),
    });
  });

  it("gives the same answer as calling the plugin directly", async () => {
    const plugin = bot({ provider: accepts("good") });
    expect(await verifyBot("good")).toEqual(await plugin.verify("good"));
  });
});
