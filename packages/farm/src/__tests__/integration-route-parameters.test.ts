import { describe, expect, it, vi } from "vitest";
import {
  defineIntegration,
  dispatchIntegrationRequest,
  integrationRoute,
  matchIntegrationRoute,
  resolveIntegrationPlugins,
} from "../integrations";

const base = { category: "custom", type: "route-parameters", instance: {} } as const;
const invalidPaths = [
  "/api/teams/[id]/members/[id]",
  "/api/teams/[id]/[...id]",
  "/api/users/[__proto__]",
  "/api/users/[...__proto__]",
  "/api/users/[constructor]",
  "/api/users/[prototype]",
];

describe("integration route parameter validation", () => {
  it.each(invalidPaths)("rejects %s in plain, typed, and grouped route definitions", (path) => {
    const handler = vi.fn(() => new Response("unexpected"));
    expect(() => defineIntegration({ ...base, routes: [{ path, handler }] })).toThrow(
      /Duplicate route parameter|reserved/,
    );
    expect(() =>
      defineIntegration({ ...base, routes: [integrationRoute.get(path, { handler })] }),
    ).toThrow(/Duplicate route parameter|reserved/);
    expect(() =>
      defineIntegration({
        ...base,
        endpoints: ({ endpoint }) => ({ nested: { item: endpoint.get(path, { handler }) } }),
      }),
    ).toThrow(/Duplicate route parameter|reserved/);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(invalidPaths)("also guards raw integration objects containing %s", async (path) => {
    const handler = vi.fn(() => new Response("unexpected"));
    const integration = { ...base, kind: "farm-integration" as const, routes: [{ path, handler }] };
    expect(() => resolveIntegrationPlugins({ custom: integration })).toThrow(
      /Duplicate route parameter|reserved/,
    );
    expect(() =>
      matchIntegrationRoute({ custom: integration }, { pathname: "/api/users/a", method: "GET" }),
    ).toThrow(/Duplicate route parameter|reserved/);
    await expect(
      dispatchIntegrationRequest(
        { integration, config: {}, isDev: false, isProd: true },
        new Request("https://farm.test/api/users/a"),
      ),
    ).rejects.toThrow(/Duplicate route parameter|reserved/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves distinct decoded values and catch-all arrays", async () => {
    const integration = defineIntegration({
      ...base,
      routes: [
        integrationRoute.get("/api/teams/[teamId]/members/[memberId]", {
          handler: (_request, { params }) => Response.json(params),
        }),
        integrationRoute.get("/api/files/[...parts]", {
          handler: (_request, { params }) => Response.json(params),
        }),
      ],
    });
    for (const [pathname, params] of [
      ["/api/teams/team-a/members/member%20b", { teamId: "team-a", memberId: "member b" }],
      ["/api/files/folder/my%20file", { parts: ["folder", "my file"] }],
    ] as const) {
      const match = matchIntegrationRoute({ custom: integration }, { pathname, method: "GET" });
      expect(match?.params).toEqual(params);
      expect(Object.getPrototypeOf(match!.params)).toBe(Object.prototype);
      const response = await dispatchIntegrationRequest(
        { integration, config: {}, isDev: false, isProd: true },
        new Request("https://farm.test" + pathname),
      );
      expect(await response?.json()).toEqual(params);
    }
  });
});
