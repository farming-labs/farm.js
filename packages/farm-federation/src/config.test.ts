import { describe, expect, it } from "vitest";
import { resolveFederationOptions } from "./config";

const reactRenderer = {
  name: "react",
  dedupe: ["react", "react-dom", "react/jsx-runtime"],
};

describe("resolveFederationOptions", () => {
  it("normalizes producers and shares the active renderer by default", () => {
    const resolved = resolveFederationOptions(
      {
        name: "checkout",
        exposes: { "./CheckoutButton": "./src/checkout-button.tsx" },
        publicPath: "https://checkout.example.com/",
      },
      reactRenderer,
    );

    expect(resolved.upstream).toMatchObject({
      name: "checkout",
      filename: "remoteEntry.js",
      manifest: true,
      dts: {
        generateTypes: { compileInChildProcess: false },
      },
      target: "web",
      publicPath: "https://checkout.example.com/",
      shared: {
        react: { singleton: true },
        "react/": { singleton: true },
        "react-dom": { singleton: true },
        "react-dom/": { singleton: true },
      },
    });
  });

  it("normalizes remote objects and keeps standard remote strings", () => {
    const resolved = resolveFederationOptions(
      {
        name: "storefront",
        remotes: {
          checkout: { entry: "https://checkout.example.com/mf-manifest.json" },
          catalog: "catalog@https://catalog.example.com/remoteEntry.js",
          account: "https://account.example.com/mf-manifest.json",
        },
        types: false,
      },
      reactRenderer,
    );

    expect(resolved.remoteAliases).toEqual(["checkout", "catalog", "account"]);
    expect(resolved.upstream.remotes).toEqual({
      checkout: {
        name: "checkout",
        entry: "https://checkout.example.com/mf-manifest.json",
        type: "module",
      },
      catalog: "catalog@https://catalog.example.com/remoteEntry.js",
      account: "https://account.example.com/mf-manifest.json",
    });
    expect(resolved.upstream.manifest).toBe(false);
    expect(resolved.upstream.dts).toBe(false);
  });

  it("merges renderer and application package shares", () => {
    const resolved = resolveFederationOptions(
      {
        name: "storefront",
        shared: {
          packages: {
            "@acme/design-system": { singleton: true, requiredVersion: "^2.0.0" },
            "date-fns": true,
          },
        },
      },
      reactRenderer,
    );

    expect(resolved.upstream.shared).toMatchObject({
      react: { singleton: true },
      "@acme/design-system": { singleton: true, requiredVersion: "^2.0.0" },
      "date-fns": {},
    });
  });

  it("allows renderer sharing to be explicitly disabled", () => {
    const resolved = resolveFederationOptions(
      { name: "vanilla-tools", shared: false },
      { name: "custom" },
    );
    expect(resolved.upstream.shared).toEqual({});
  });

  it("rejects unsafe paths, remote URLs, and server options", () => {
    expect(() =>
      resolveFederationOptions({ name: "remote", filename: "../remoteEntry.js" }, reactRenderer),
    ).toThrow("safe relative");
    expect(() =>
      resolveFederationOptions(
        {
          name: "host",
          remotes: { checkout: { entry: "file:///tmp/remoteEntry.js" } },
        },
        reactRenderer,
      ),
    ).toThrow("must use HTTP");
    for (const entry of [
      "https://user:secret@checkout.example.com/remoteEntry.js",
      "checkout@https://user:secret@checkout.example.com/remoteEntry.js",
      "//checkout.example.com/remoteEntry.js",
      "/\\checkout.example.com/remoteEntry.js",
      "checkout@file:///tmp/remoteEntry.js",
    ]) {
      expect(() =>
        resolveFederationOptions({ name: "host", remotes: { checkout: entry } }, reactRenderer),
      ).toThrow();
    }
    for (const publicPath of [
      "//cdn.example.com/assets/",
      "/\\cdn.example.com/assets/",
      "https:\\cdn.example.com\\assets\\",
    ]) {
      expect(() => resolveFederationOptions({ name: "host", publicPath }, reactRenderer)).toThrow();
    }
    expect(() =>
      resolveFederationOptions({ name: "host", serverRemotes: {} } as never, reactRenderer),
    ).toThrow("issues/885");
  });

  it("requires custom renderers to declare or disable shared packages", () => {
    expect(() => resolveFederationOptions({ name: "host" }, { name: "custom-renderer" })).toThrow(
      "does not declare packages",
    );
  });
});
