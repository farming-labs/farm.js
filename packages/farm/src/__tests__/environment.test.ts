// @vitest-environment node

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createClientOnlyFn,
  createIsomorphicFn,
  createServerOnlyFn,
  FarmEnvironmentError,
} from "../environment";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("environment functions", () => {
  it("preserves server-only function types and behavior on the server", async () => {
    const readSecret = createServerOnlyFn(
      async (prefix: string, count: number) => `${prefix}:${count}`,
    );

    expectTypeOf(readSecret).parameters.toEqualTypeOf<[string, number]>();
    expectTypeOf(readSecret).returns.toEqualTypeOf<Promise<string>>();
    await expect(readSecret("secret", 2)).resolves.toBe("secret:2");

    const identity = createServerOnlyFn(<T>(value: T) => value);
    expectTypeOf(identity("farm" as const)).toEqualTypeOf<"farm">();
  });

  it("replaces client-only functions with a descriptive server mismatch", () => {
    const readStorage = createClientOnlyFn(() => "theme");

    expect(() => readStorage()).toThrowError(FarmEnvironmentError);
    try {
      readStorage();
    } catch (error) {
      expect(error).toMatchObject({
        name: "FarmEnvironmentError",
        code: "FARM_ENVIRONMENT_MISMATCH",
        api: "createClientOnlyFn",
        expected: "client",
        actual: "server",
      });
    }
  });

  it("selects the server implementation of an isomorphic function", () => {
    const formatPath = createIsomorphicFn({
      server: (value: string) => `server:${value}`,
      client: (value: string) => `client:${value}`,
    });

    expectTypeOf(formatPath).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(formatPath).returns.toEqualTypeOf<string>();
    expect(formatPath("farm")).toBe("server:farm");

    const readVersion = createIsomorphicFn({
      server: () => 1,
      client: () => "browser",
    });
    expectTypeOf(readVersion).returns.toEqualTypeOf<number | string>();
  });

  it("uses client implementations and server-only mismatch stubs in a browser runtime", () => {
    vi.stubGlobal("window", {});

    const readStorage = createClientOnlyFn((key: string) => `storage:${key}`);
    const readSecret = createServerOnlyFn(() => "secret");
    const formatPath = createIsomorphicFn({
      server: (value: string) => `server:${value}`,
      client: (value: string) => `client:${value}`,
    });

    expect(readStorage("theme")).toBe("storage:theme");
    expect(formatPath("farm")).toBe("client:farm");
    expect(() => readSecret()).toThrow(
      "createServerOnlyFn() can only be called on the server. It was called on the client.",
    );
  });

  it("validates implementations on the environment where they execute", () => {
    expect(() => (createServerOnlyFn as any)(null)).toThrow(
      "createServerOnlyFn must be a function",
    );
    expect(() => (createIsomorphicFn as any)(null)).toThrow(
      "createIsomorphicFn requires server and client functions",
    );
    expect(() => (createIsomorphicFn as any)({ server: () => undefined, client: null })).toThrow(
      "createIsomorphicFn client must be a function",
    );
  });

  it("supports compiler-generated mismatches independently of runtime globals", () => {
    const boundary = (createServerOnlyFn as any)(undefined, "client");

    expect(() => boundary()).toThrowError(FarmEnvironmentError);
  });
});
