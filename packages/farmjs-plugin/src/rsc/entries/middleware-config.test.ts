import { describe, expect, it } from "vitest";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1_000_000 },
  deploymentId: "middleware-config-test",
  debug: false,
};

describe("generated middleware runner options", () => {
  it("carries the resolved i18n config so locale prefixes strip before matching", () => {
    const entry = generateRscEntry({
      ...context,
      i18n: {
        enabled: true,
        basePath: "/",
        locales: ["en", "de"],
        defaultLocale: "en",
        messages: "/app/src/messages",
        routing: "prefix",
        detection: ["cookie"],
        fallbackLocale: "en",
        strict: true,
        cookie: { name: "farm_locale", maxAge: 31_536_000, path: "/", sameSite: "lax" },
        direction: { en: "ltr", de: "ltr" },
      },
    });

    // Without this the runner matches the raw pathname, so a `/de/dashboard`
    // request never reaches a `/dashboard` middleware.
    expect(entry).toContain('"enabled":true');
    expect(entry).toContain('"routing":"prefix"');
    expect(entry).toContain('"locales":["en","de"]');
    expect(entry).toMatch(/i18n: \{"enabled":true/);
  });

  it("carries trustProxy so middleware reads the forwarded client address", () => {
    const entry = generateRscEntry({ ...context, server: { trustProxy: true } });
    expect(entry).toContain('server: {"trustProxy":true}');
  });

  it("does not claim to trust a proxy that was not configured", () => {
    const entry = generateRscEntry({ ...context, server: { trustProxy: false } });
    expect(entry).toContain('server: {"trustProxy":false}');
  });

  it("omits both when the plugin has nothing resolved to pass", () => {
    const entry = generateRscEntry(context);
    // `undefined` rather than `null`, so the emitted object matches the
    // runner's optional option shape.
    expect(entry).toContain("i18n: undefined");
    expect(entry).toContain("server: undefined");
  });

  it("imports live middleware configs in layer-to-project order", () => {
    const entry = generateRscEntry({
      ...context,
      middlewareConfigPaths: ["C:\\layers\\base\\farm.config.ts", "/app/farm.config.ts"],
    });

    expect(entry).toContain(
      'import * as FarmMiddlewareConfigModule0 from "C:/layers/base/farm.config.ts";',
    );
    expect(entry).toContain('import * as FarmMiddlewareConfigModule1 from "/app/farm.config.ts";');
    expect(entry).toContain(
      "const farmRuntimeConfigs = [(FarmMiddlewareConfigModule0.default || FarmMiddlewareConfigModule0), (FarmMiddlewareConfigModule1.default || FarmMiddlewareConfigModule1)].filter(Boolean);",
    );
    expect(entry).toContain("config: farmConfigMiddleware");
  });
});
