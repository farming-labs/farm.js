// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { generateNativeAuthIntegrationSource } from "../nitro/universal-build";
import { resolveFarmAuthConfig } from "../auth-config";

describe("native auth integration in the production entry", () => {
  it("registers the auth integration so its routes exist in a built server", () => {
    const auth = resolveFarmAuthConfig(true);
    const { importSource, registerSource } = generateNativeAuthIntegrationSource(auth);

    // A literal import keeps the bundler tracing @farm.js/auth into the
    // server output instead of leaving it out of the bundle entirely.
    expect(importSource).toContain('from "@farm.js/auth/internal"');
    expect(importSource).toContain("createFarmAuthIntegration");

    // Execute the generated registration the way the entry does.
    const createFarmAuthIntegration = vi.fn(() => ({ kind: "farm-integration", routes: [] }));
    const configuredIntegrations: Record<string, unknown> = {};
    new Function(
      "configuredIntegrations",
      "__farmCreateAuthIntegration",
      "process",
      registerSource,
    )(configuredIntegrations, createFarmAuthIntegration, { cwd: () => "/srv/app" });

    expect(configuredIntegrations.auth).toBeDefined();
    expect(createFarmAuthIntegration).toHaveBeenCalledTimes(1);

    const [passedConfig, passedOptions] = createFarmAuthIntegration.mock.calls[0] as [
      { basePath: string; enabled: boolean },
      { root: string; mode: string },
    ];
    expect(passedConfig.enabled).toBe(true);
    expect(passedConfig.basePath).toBe("/api/auth");
    // Production mode makes the auth runtime require a real FARM_AUTH_SECRET
    // rather than falling back to its development constant.
    expect(passedOptions.mode).toBe("production");
    // The server's own working directory, not a baked build-machine path.
    expect(passedOptions.root).toBe("/srv/app");
  });

  it("carries a custom basePath through to the built server", () => {
    const auth = resolveFarmAuthConfig({ basePath: "/internal/auth" });
    const { registerSource } = generateNativeAuthIntegrationSource(auth);

    expect(registerSource).toContain("/internal/auth");
  });

  it("emits nothing when auth is not enabled", () => {
    for (const auth of [
      resolveFarmAuthConfig(undefined),
      resolveFarmAuthConfig(false),
      resolveFarmAuthConfig({ enabled: false }),
      undefined,
    ]) {
      const { importSource, registerSource } = generateNativeAuthIntegrationSource(auth);
      expect(importSource).toBe("");
      expect(registerSource).toBe("");
    }
  });
});
