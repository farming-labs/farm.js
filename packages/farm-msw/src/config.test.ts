import { describe, expect, it } from "vitest";
import { resolveMswOptions } from "./config.js";

describe("resolveMswOptions", () => {
  it("keeps the common setup concise", () => {
    expect(resolveMswOptions({ handlers: " ./src/mocks/handlers.ts " })).toEqual({
      handlers: "./src/mocks/handlers.ts",
      browser: true,
      server: true,
      onUnhandledRequest: "bypass",
      enabled: true,
    });
  });

  it("supports opting out of either runtime", () => {
    expect(
      resolveMswOptions({
        handlers: "src/mocks/handlers.ts",
        browser: false,
        server: false,
        enabled: false,
        onUnhandledRequest: "error",
      }),
    ).toMatchObject({
      browser: false,
      server: false,
      enabled: false,
      onUnhandledRequest: "error",
    });
  });

  it.each([
    [{ handlers: "" }, "handlers"],
    [{ handlers: "mocks.ts", browser: "yes" }, "browser"],
    [{ handlers: "mocks.ts", server: 1 }, "server"],
    [{ handlers: "mocks.ts", enabled: "no" }, "enabled"],
    [{ handlers: "mocks.ts", onUnhandledRequest: "ignore" }, "onUnhandledRequest"],
  ])("rejects invalid options %#", (options, message) => {
    expect(() => resolveMswOptions(options as never)).toThrow(message);
  });
});
