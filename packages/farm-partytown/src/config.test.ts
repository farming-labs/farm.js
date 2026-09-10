import { describe, expect, it } from "vitest";
import { defineForward } from "./client.js";
import { resolvePartytownOptions } from "./config.js";

describe("resolvePartytownOptions", () => {
  it("keeps the default setup small", () => {
    expect(resolvePartytownOptions({})).toEqual({
      forward: [],
      debug: undefined,
      fallbackTimeout: undefined,
      strictProxyHas: undefined,
    });
  });

  it("normalizes and deduplicates raw and typed forwards", () => {
    const track = defineForward<(event: string) => void>("mixpanel.track");
    const intercom = defineForward<(...args: unknown[]) => void>("Intercom", {
      preserveBehavior: true,
    });

    expect(
      resolvePartytownOptions({
        forward: [" mixpanel.track ", track, intercom],
        fallbackTimeout: 4_000,
        strictProxyHas: true,
      }),
    ).toEqual({
      forward: [
        { path: "mixpanel.track", preserveBehavior: false },
        { path: "Intercom", preserveBehavior: true },
      ],
      debug: undefined,
      fallbackTimeout: 4_000,
      strictProxyHas: true,
    });
  });

  it.each([
    [null, "options must be an object"],
    [{ enabled: false }, "remove partytown() from plugins"],
    [{ debug: "yes" }, "debug must be boolean"],
    [{ forward: "analytics.track" }, "forward must be an array"],
    [{ fallbackTimeout: -1 }, "non-negative integer"],
    [{ forward: ["analytics.constructor.call"] }, "safe dotted"],
  ])("rejects invalid options %#", (options, message) => {
    expect(() => resolvePartytownOptions(options as never)).toThrow(message);
  });

  it("rejects conflicting behavior for one forwarded path", () => {
    const preserved = defineForward<(...args: unknown[]) => void>("dataLayer.push", {
      preserveBehavior: true,
    });
    expect(() => resolvePartytownOptions({ forward: ["dataLayer.push", preserved] })).toThrow(
      "conflicting preserveBehavior",
    );
  });
});
