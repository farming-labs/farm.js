import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { component } from "../component.js";
import { checkServiceHomes, findConvexComponents, findFarmIntegrations } from "../homes.js";

const POLAR_AND_BETTER_AUTH_CONFIG = `import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import polar from '@convex-dev/polar/convex.config.js';
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();
app.use(betterAuth);
app.use(polar);
app.use(rateLimiter);
export default app;
`;

function createAppRoot(convexConfigSource?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-convex-homes-"));
  if (convexConfigSource === undefined) return root;
  mkdirSync(path.join(root, "convex"));
  writeFileSync(path.join(root, "convex", "convex.config.ts"), convexConfigSource);
  return root;
}

describe("findConvexComponents", () => {
  it("finds the auth and billing components an app installs", () => {
    expect(findConvexComponents(POLAR_AND_BETTER_AUTH_CONFIG)).toEqual([
      { service: "auth", side: "convex", name: "@convex-dev/better-auth" },
      { service: "billing", side: "convex", name: "@convex-dev/polar" },
    ]);
  });
});

describe("findFarmIntegrations", () => {
  it("ignores Farm's built-in auth when the resolved config turns it off", () => {
    expect(findFarmIntegrations({ auth: { enabled: false, basePath: "/api/auth" } })).toEqual([]);
  });

  it("counts Farm's built-in auth", () => {
    expect(findFarmIntegrations({ auth: true })).toEqual([
      { service: "auth", side: "farm", name: "farm-auth" },
    ]);
  });
});

describe("checkServiceHomes", () => {
  it("passes when a service lives only in Convex", () => {
    const root = createAppRoot(POLAR_AND_BETTER_AUTH_CONFIG);
    expect(() => checkServiceHomes({ root, integrations: {} }, "convex", {})).not.toThrow();
  });

  it("passes when a service lives only in Farm", () => {
    const root = createAppRoot(
      `import { defineApp } from "convex/server";\nexport default defineApp();\n`,
    );
    const integrations = { billing: { type: "polar" } };
    expect(() => checkServiceHomes({ root, integrations }, "convex", {})).not.toThrow();
  });

  it("passes when the app has no Convex config", () => {
    const root = createAppRoot();
    const integrations = { billing: { type: "polar" } };
    expect(() => checkServiceHomes({ root, integrations }, "convex", {})).not.toThrow();
  });

  it("stops when billing is set up on both sides and names the home option", () => {
    const root = createAppRoot(POLAR_AND_BETTER_AUTH_CONFIG);
    const integrations = { billing: { type: "polar" } };
    expect(() => checkServiceHomes({ root, integrations }, "convex", {})).toThrow(
      /billing is set up in Convex \(@convex-dev\/polar\) and in Farm \(polar\).*home: \{ billing/,
    );
  });

  it("lets the home option settle a conflict", () => {
    const root = createAppRoot(POLAR_AND_BETTER_AUTH_CONFIG);
    const integrations = { billing: { type: "polar" } };
    expect(() =>
      checkServiceHomes({ root, integrations }, "convex", { billing: "convex" }),
    ).not.toThrow();
  });

  it("stops when Farm's built-in auth runs next to Better Auth in Convex", () => {
    const root = createAppRoot(POLAR_AND_BETTER_AUTH_CONFIG);
    expect(() => checkServiceHomes({ root, auth: true }, "convex", {})).toThrow(/farm-auth/);
  });

  it("accepts auth and billing extensions whose components are installed", () => {
    const root = createAppRoot(POLAR_AND_BETTER_AUTH_CONFIG);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const extensions = [component("@convex-dev/better-auth"), component("@convex-dev/polar")];
    expect(() =>
      checkServiceHomes({ root, integrations: {} }, "convex", {}, extensions),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops when an extension provides a service that a Farm integration also provides", () => {
    const root = createAppRoot();
    const integrations = { auth: { type: "better-auth" } };
    expect(() =>
      checkServiceHomes({ root, integrations }, "convex", {}, [
        component("@convex-dev/better-auth"),
      ]),
    ).toThrow(/auth is set up in Convex \(@convex-dev\/better-auth\) and in Farm \(better-auth\)/);
  });

  it("lets WorkOS AuthKit in Convex run with Farm's WorkOS sign-in", () => {
    const root = createAppRoot(`import authKit from "@convex-dev/workos-authkit/convex.config";\n`);
    const integrations = { auth: { type: "workos" } };
    expect(() =>
      checkServiceHomes({ root, integrations }, "convex", {}, [
        component("@convex-dev/workos-authkit"),
      ]),
    ).not.toThrow();
  });

  it("stops when Stripe lives in Convex and Farm's stripe() is registered too", () => {
    const root = createAppRoot(`import stripe from "@convex-dev/stripe/convex.config";\n`);
    const integrations = { billing: { type: "stripe" } };
    expect(() =>
      checkServiceHomes({ root, integrations }, "convex", {}, [component("@convex-dev/stripe")]),
    ).toThrow(/billing is set up in Convex \(@convex-dev\/stripe\) and in Farm \(stripe\)/);
  });

  it("warns when an extension's component is not in convex.config.ts", () => {
    const root = createAppRoot(`import { defineApp } from "convex/server";\n`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    checkServiceHomes({ root, integrations: {} }, "convex", {}, [component("@convex-dev/polar")]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "polar (@convex-dev/polar) is in convex({ use }) but not in convex.config.ts",
      ),
    );
    warn.mockRestore();
  });

  it("allows WorkOS sign-in in Farm together with the AuthKit component in Convex", () => {
    const root = createAppRoot(
      `import workOSAuthKit from "@convex-dev/workos-authkit/convex.config";\n`,
    );
    const integrations = { auth: { type: "workos" } };
    expect(() => checkServiceHomes({ root, integrations }, "convex", {})).not.toThrow();
  });

  it("reads a custom functions directory", () => {
    const root = createAppRoot();
    mkdirSync(path.join(root, "backend"));
    writeFileSync(path.join(root, "backend", "convex.config.ts"), POLAR_AND_BETTER_AUTH_CONFIG);
    const integrations = { billing: { type: "stripe" } };
    expect(() => checkServiceHomes({ root, integrations }, "backend", {})).toThrow(/stripe/);
  });
});
