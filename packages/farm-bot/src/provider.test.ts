import { describe, expect, it } from "vitest";
import { BotError } from "./errors";
import { botProviderIssues, defineBotProvider, type BotProvider } from "./provider";

const verify: BotProvider["verify"] = async () => ({ success: false, code: "rejected" });

describe("defineBotProvider", () => {
  it("returns the provider object unchanged", () => {
    const provider = { name: "acme", verify };
    expect(defineBotProvider(provider)).toBe(provider);
  });

  it("accepts a provider with no token and no browser half", () => {
    expect(botProviderIssues({ name: "ip-reputation", verify })).toEqual([]);
  });

  it("reports every problem at once", () => {
    expect(() =>
      defineBotProvider({
        name: "Not Valid",
        tokenField: "",
        maxTokenLength: -1,
        csp: { "script-src": ["https://a.example; script-src *"] },
        client: "nope" as never,
        verify: undefined as never,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "BotError",
        code: "invalid_provider",
        message: expect.stringMatching(/name.*verify.*client.*tokenField.*maxTokenLength.*csp/s),
      }),
    );
  });

  it("rejects a CSP source that could add its own directive", () => {
    expect(() =>
      defineBotProvider({ name: "acme", csp: { "script-src": ["a;b"] }, verify }),
    ).toThrow(BotError);
    expect(() =>
      defineBotProvider({ name: "acme", csp: { "script src": ["https://a.example"] }, verify }),
    ).toThrow(/directive name/);
  });

  it("explains what to pass when the provider isn't an object", () => {
    expect(botProviderIssues(undefined)).toEqual([
      expect.stringContaining("The provider must be an object."),
    ]);
  });
});
