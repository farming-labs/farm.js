import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { component } from "../component.js";
import { convex } from "../index.js";
import { readConvexRuntime } from "../runtime.js";
import { startRecordingServer } from "./recording-server.js";

import type { ConvexExtension } from "../types.js";
import type { RecordingServer } from "./types.js";

const url = "https://happy-otter-123.convex.cloud";
const betterAuth = () => component("@convex-dev/better-auth");

describe("convex({ use })", () => {
  it("mounts Better Auth on the app's domain, reads its token, and points the browser at it", () => {
    const integration = convex({ url, dev: false, detect: false, use: [betterAuth()] });
    expect(integration.routes?.map((route) => [route.path, route.methods])).toEqual([
      ["/api/auth/[...auth]", ["GET", "POST"]],
    ]);
    expect(integration.providers?.[0]?.props).toEqual({ url, tokenPath: "/api/auth/convex/token" });
    expect(integration.providers?.[0]?.component).toEqual({
      module: "@farm.js/convex/client",
      export: "ConvexClientProvider",
    });
    expect(readConvexRuntime()?.token).toBeTypeOf("function");
  });

  it("lets the app's own token reader, token path and provider win", () => {
    const token = () => "app-token";
    const provider = { module: "@/lib/provider", export: "AppProvider" };
    const integration = convex({
      url,
      dev: false,
      detect: false,
      token,
      tokenPath: "/api/auth/token",
      provider,
      use: [betterAuth()],
    });
    expect(readConvexRuntime()?.token).toBe(token);
    expect(integration.providers?.[0]?.props).toEqual({ url, tokenPath: "/api/auth/token" });
    expect(integration.providers?.[0]?.component).toEqual(provider);
  });

  it("points the browser at a token path for auth that lives in Farm", () => {
    const integration = convex({ url, dev: false, detect: false, tokenPath: "/api/auth/token" });
    expect(integration.providers?.[0]?.props).toEqual({ url, tokenPath: "/api/auth/token" });
  });

  it("refuses two extensions that provide the same service", () => {
    const magicLink: ConvexExtension = { name: "magic-link", service: "auth" };
    expect(() =>
      convex({ url, dev: false, detect: false, use: [betterAuth(), magicLink] }),
    ).toThrow(/better-auth and magic-link both provide auth/);
    const billing = [component("@convex-dev/polar"), component("@convex-dev/stripe")];
    expect(() => convex({ url, dev: false, detect: false, use: billing })).toThrow(
      /polar and stripe both provide billing/,
    );
  });

  it("refuses two extensions that both read a visitor token", () => {
    const first: ConvexExtension = { name: "first", token: () => "a" };
    const second: ConvexExtension = { name: "second", token: () => "b" };
    expect(() => convex({ url, dev: false, detect: false, use: [first, second] })).toThrow(
      /first and second both read a visitor token/,
    );
  });

  it("refuses route paths that are not absolute or are taken twice", () => {
    const relative: ConvexExtension = { name: "relative", routes: [{ path: "api/hooks" }] };
    expect(() => convex({ url, dev: false, detect: false, use: [relative] })).toThrow(
      /starting with "\/"/,
    );
    const first: ConvexExtension = { name: "first", routes: [{ path: "/api/hooks" }] };
    const second: ConvexExtension = { name: "second", routes: [{ path: "/api/hooks" }] };
    expect(() => convex({ url, dev: false, detect: false, use: [first, second] })).toThrow(
      /first and second both route \/api\/hooks/,
    );
  });
});

describe("component()", () => {
  it.each([
    ["@convex-dev/polar", "polar", "billing", "/api/webhooks/polar", "/polar/events"],
    ["@convex-dev/stripe", "stripe", "billing", "/api/webhooks/stripe", "/stripe/webhook"],
    ["@convex-dev/resend", "resend", undefined, "/api/webhooks/resend", "/resend-webhook"],
    [
      "@convex-dev/workos-authkit",
      "workos-authkit",
      "auth",
      "/api/webhooks/workos",
      "/workos/webhook",
    ],
  ] as const)("knows %s's webhook paths", (pkg, name, service, path, to) => {
    expect(component(pkg)).toEqual({
      name,
      component: pkg,
      routes: [],
      ...(service ? { service } : {}),
    });
    expect(component(pkg, { webhooks: true }).routes).toEqual([{ path, methods: ["POST"], to }]);
    expect(component(pkg, { webhooks: "/hooks/x", convexPath: "/custom" }).routes).toEqual([
      { path: "/hooks/x", methods: ["POST"], to: "/custom" },
    ]);
  });

  it("knows Autumn is billing with nothing to forward", () => {
    expect(component("@useautumn/convex")).toEqual({
      name: "autumn",
      component: "@useautumn/convex",
      service: "billing",
      routes: [],
    });
  });

  it("takes routes for any other component", () => {
    const sms = component("@acme/convex-sms", { routes: { "/api/hooks/sms": "/sms" } });
    expect(sms).toEqual({
      name: "@acme/convex-sms",
      component: "@acme/convex-sms",
      routes: [{ path: "/api/hooks/sms", to: "/sms" }],
    });
  });

  it("asks for paths when an unknown component's webhooks are turned on", () => {
    expect(() => component("@acme/convex-sms", { webhooks: true })).toThrow(/no default webhook/);
  });

  it("treats a component that signs visitors in as auth", () => {
    const sso = component("@acme/convex-sso", { token: () => "token" });
    const magicLink: ConvexExtension = { name: "magic-link", service: "auth" };
    expect(() => convex({ url, dev: false, detect: false, use: [sso, magicLink] })).toThrow(
      /@acme\/convex-sso and magic-link both provide auth/,
    );
  });

  it("needs a package name", () => {
    expect(() => component(" ")).toThrow(/package name/);
  });
});

describe("@farm.js/convex", () => {
  it("exports component() and no vendor-specific helpers", async () => {
    const entry: Record<string, unknown> = await import("../index.js");
    expect(entry.component).toBeTypeOf("function");
    for (const name of ["betterAuth", "polar", "stripe", "autumn", "resend", "workosAuthKit"]) {
      expect(entry[name]).toBeUndefined();
    }
  });
});

describe("extension routes", () => {
  let convexSite: RecordingServer;

  beforeAll(async () => {
    convexSite = await startRecordingServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
  });

  afterAll(() => convexSite.close());

  it("forwards a webhook from the app's domain to the component's Convex path", async () => {
    const integration = convex({
      url,
      siteURL: convexSite.url,
      dev: false,
      detect: false,
      use: [component("@convex-dev/polar", { webhooks: true })],
    });
    const route = integration.routes?.[0];
    const request = new Request("https://app.example.com/api/webhooks/polar", {
      method: "POST",
      body: '{"type":"subscription.created"}',
    });
    const response = await route?.handler(request, {} as never);
    expect(response?.status).toBe(200);
    expect(convexSite.requests.at(-1)?.url).toBe("/polar/events");
    expect(convexSite.requests.at(-1)?.body).toBe('{"type":"subscription.created"}');
  });
});
