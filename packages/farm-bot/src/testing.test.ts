import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineBotWidget } from "./client";
import type { BotProvider } from "./provider";
import { checkBotProvider } from "./testing";

const reject: BotProvider["verify"] = async () => ({ success: false, code: "rejected" });

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

describe("checkBotProvider", () => {
  it("passes a server-only provider", async () => {
    expect(await checkBotProvider({ name: "ip", verify: reject })).toEqual([]);
  });

  it("reports an invalid shape", async () => {
    expect(await checkBotProvider({ name: "Bad Name" } as never)).toEqual([
      expect.stringContaining("`name`"),
      expect.stringContaining("`verify`"),
    ]);
  });

  it("reports a provider that accepts everything", async () => {
    expect(
      await checkBotProvider({ name: "yes", verify: async () => ({ success: true }) }),
    ).toEqual(["`verify` accepted a submission it should refuse."]);
  });

  it("reports a provider that throws on a bad submission", async () => {
    const issues = await checkBotProvider({
      name: "throws",
      verify: async () => {
        throw new Error("nope");
      },
    });
    expect(issues[0]).toContain("threw");
  });

  it("reports a malformed verdict and an unknown code", async () => {
    expect(await checkBotProvider({ name: "bad", verify: async () => ({}) as never })).toEqual([
      expect.stringContaining("must return"),
    ]);
    expect(
      await checkBotProvider({
        name: "bad",
        verify: async () => ({ success: false, code: "nope" as never }),
      }),
    ).toEqual([expect.stringContaining("unknown code")]);
  });

  it("finds a secret in the browser config", async () => {
    const provider: BotProvider = {
      name: "leaky",
      verify: reject,
      client: () => ({ widget: "leaky/widget", public: { key: "sk_live_123" } }),
    };
    expect(await checkBotProvider(provider, { secrets: ["sk_live_123"] })).toEqual([
      "`client().public` contains a secret.",
    ]);
  });

  it("applies Farm's rules for public data", async () => {
    for (const value of [{ a: undefined }, { a: new Date(0) }, { a: Number.NaN }]) {
      expect(
        await checkBotProvider({
          name: "public",
          verify: reject,
          client: () => ({ widget: "public/widget", public: value }),
        }),
      ).toEqual(["`client().public` must be plain JSON."]);
    }
  });

  it("reports a missing or relative widget path", async () => {
    const check = (widget: unknown) =>
      checkBotProvider({
        name: "paths",
        verify: reject,
        client: () => ({ widget }) as never,
      });
    expect(await check(undefined)).toEqual([expect.stringContaining("`{ widget }`")]);
    expect(await check("./acme.widget.ts")).toEqual([expect.stringContaining("relative path")]);
    expect(await check("/src/acme.widget.ts")).toEqual([]);
    expect(await check("acme-bot/widget")).toEqual([]);
  });

  describe("with `widget`", () => {
    const withBrowser: BotProvider = {
      name: "browser",
      verify: reject,
      client: () => ({ widget: "/src/browser.widget.ts", public: { minMs: 1 } }),
    };

    it("runs the widget's lifecycle with the provider's public data", async () => {
      const seen: unknown[] = [];
      const widget = defineBotWidget<{ minMs: number }>((config) => {
        seen.push(config);
        return {
          mount(element) {
            const box = element.ownerDocument.createElement("div");
            element.append(box);
            return { reset() {}, remove: () => box.remove() };
          },
        };
      });
      expect(await checkBotProvider(withBrowser, { widget })).toEqual([]);
      expect(seen).toEqual([{ minMs: 1 }]);
    });

    it("accepts a widget that draws nothing", async () => {
      expect(await checkBotProvider(withBrowser, { widget: defineBotWidget(() => {}) })).toEqual(
        [],
      );
    });

    it("reports a widget that leaves elements behind", async () => {
      const widget = defineBotWidget(() => ({
        mount(element) {
          element.append(element.ownerDocument.createElement("div"));
          return { reset() {}, remove() {} };
        },
      }));
      expect(await checkBotProvider(withBrowser, { widget })).toEqual([
        expect.stringContaining("left elements behind"),
      ]);
    });

    it("reports a malformed widget and one that throws", async () => {
      expect(await checkBotProvider(withBrowser, { widget: (() => ({})) as never })).toEqual([
        expect.stringContaining("with `mount`"),
      ]);
      expect(
        await checkBotProvider(withBrowser, {
          widget: (() => ({ mount: () => ({}) })) as never,
        }),
      ).toEqual([expect.stringContaining("`{ reset, remove }`")]);
      expect(
        await checkBotProvider(withBrowser, {
          widget: () => {
            throw new Error("boom");
          },
        }),
      ).toEqual([expect.stringContaining("boom")]);
    });
  });

  it("passes the request and IP it's given to the provider", async () => {
    const request = new Request("https://shop.example.com/");
    let seen: unknown[] = [];
    await checkBotProvider(
      {
        name: "reads-request",
        verify: async (input) => {
          seen = [input.request, input.remoteIp];
          return { success: false, code: "rejected" };
        },
      },
      { request, remoteIp: "203.0.113.7" },
    );
    expect(seen).toEqual([request, "203.0.113.7"]);
  });

  it("reports a client() that throws", async () => {
    const issues = await checkBotProvider({
      name: "throws",
      verify: reject,
      client: () => {
        throw new Error("no site key");
      },
    });
    expect(issues[0]).toContain("no site key");
  });
});
