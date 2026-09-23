import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { defineForward } from "./client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defineForward", () => {
  it("creates a typed caller and invokes the nested browser function with its owner", () => {
    const calls: Array<[string, Record<string, string> | undefined]> = [];
    const mixpanel = {
      track(event: string, properties?: Record<string, string>) {
        expect(this).toBe(mixpanel);
        calls.push([event, properties]);
      },
    };
    vi.stubGlobal("window", { mixpanel });

    const track =
      defineForward<(event: string, properties?: Record<string, string>) => void>("mixpanel.track");
    track("project_created", { source: "dashboard" });

    expect(calls).toEqual([["project_created", { source: "dashboard" }]]);
    expect(track.path).toBe("mixpanel.track");
    expect(track.preserveBehavior).toBe(false);
    expectTypeOf(track).parameter(0).toEqualTypeOf<string>();
  });

  it("is a safe no-op during SSR and before a vendor forward exists", () => {
    const track = defineForward<(event: string) => void>("analytics.track");
    expect(() => track("server_rendered")).not.toThrow();

    vi.stubGlobal("window", {});
    expect(() => track("before_bootstrap")).not.toThrow();
  });

  it("validates paths and options before creating a caller", () => {
    expect(() => defineForward('mixpanel["track"]')).toThrow("safe dotted");
    expect(() => defineForward("analytics.__proto__.track")).toThrow("safe dotted");
    expect(() => defineForward("analytics.track", { preserveBehavior: "yes" as never })).toThrow(
      "preserveBehavior must be boolean",
    );
  });
});
