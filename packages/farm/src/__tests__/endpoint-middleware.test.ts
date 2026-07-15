import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  createEndpoint,
  POST,
  type EndpointMiddlewareContext,
  type TypedEndpoint,
} from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/route-manager";

type Session = {
  user: {
    id: string;
    roles: string[];
  };
};

interface AuditContext {
  auditId: string;
}

const withAudit = async (): Promise<AuditContext> => ({ auditId: "audit-1" });

const returnsNothing = async () => {};

// @ts-expect-error Middleware must continue, deny, respond, or provide context.
const invalidEndpoint = createEndpoint(
  {
    method: "GET",
    middleware: [returnsNothing],
  },
  () => ({ ok: true }),
);
void invalidEndpoint;

const withSession = async ({ request }: EndpointMiddlewareContext) => {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "x-auth-required": "true" } },
    );
  }

  const session: Session = {
    user: {
      id: userId,
      roles: ["admin"],
    },
  };
  return { session };
};

describe("createEndpoint middleware", () => {
  it("passes validated input and accumulated typed context to the handler", async () => {
    const trace: string[] = [];
    const loadProject = async ({
      body,
      context,
    }: EndpointMiddlewareContext<{ session: Session }, { projectId: string }>) => {
      expectTypeOf(context.session.user.id).toEqualTypeOf<string>();
      trace.push(`project:${body.projectId}:${context.session.user.id}`);
      return {
        project: {
          id: body.projectId,
          ownerId: context.session.user.id,
        },
      };
    };
    const endpoint = createEndpoint(
      {
        method: "PATCH",
        body: z.object({ projectId: z.string().min(1) }),
        query: z.object({ source: z.enum(["form", "api"]) }),
        headers: z.object({ "x-user-id": z.string().min(1) }),
        middleware: [withSession, loadProject, withAudit, () => true],
      },
      ({ body, query, headers, context }) => {
        expectTypeOf(context.session).toEqualTypeOf<Session>();
        expectTypeOf(context.project).toEqualTypeOf<{
          id: string;
          ownerId: string;
        }>();
        expectTypeOf(context.auditId).toEqualTypeOf<string>();
        expectTypeOf(body.projectId).toEqualTypeOf<string>();
        expectTypeOf(query.source).toEqualTypeOf<"form" | "api">();
        expectTypeOf(headers["x-user-id"]).toEqualTypeOf<string>();
        expect(Object.isFrozen(context)).toBe(true);
        trace.push("handler");

        return {
          id: context.project.id,
          userId: context.session.user.id,
          auditId: context.auditId,
          source: query.source,
        };
      },
    );

    expectTypeOf(endpoint).toMatchTypeOf<
      TypedEndpoint<
        { projectId: string },
        { source: "form" | "api" },
        { id: string; userId: string; auditId: string; source: "form" | "api" },
        { "x-user-id": string }
      >
    >();

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/projects/42?source=form", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": "user-1",
        },
        body: JSON.stringify({ projectId: "42" }),
      }),
      { id: "42" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "42",
      userId: "user-1",
      auditId: "audit-1",
      source: "form",
    });
    expect(trace).toEqual(["project:42:user-1", "handler"]);
  });

  it("validates all endpoint input before middleware runs", async () => {
    const middleware = vi.fn(withSession);
    const handler = vi.fn(() => ({ ok: true }));
    const endpoint = createEndpoint(
      {
        method: "POST",
        body: z.object({ name: z.string().min(2) }),
        headers: z.object({ "x-user-id": z.string().min(1) }),
        middleware: [middleware],
      },
      handler,
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Farm" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid request headers" });
    expect(middleware).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("uses a returned Response as the exact short-circuit result", async () => {
    const later = vi.fn(() => true as const);
    const handler = vi.fn(() => ({ ok: true }));
    const endpoint = createEndpoint(
      {
        method: "GET",
        middleware: [withSession, later],
      },
      handler,
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/private"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-auth-required")).toBe("true");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(later).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("turns false into a 403 and does not call later middleware or the handler", async () => {
    const later = vi.fn(() => ({ loaded: true }));
    const handler = vi.fn(() => ({ ok: true }));
    const endpoint = createEndpoint(
      {
        method: "GET",
        middleware: [() => true as const, () => false as const, later],
      },
      handler,
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/admin"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(later).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an array", []],
  ])("rejects %s middleware returns", async (_label, result) => {
    const endpoint = createEndpoint(
      {
        method: "GET",
        middleware: [(() => result) as any],
      },
      () => ({ ok: true }),
    );

    await expect(
      invokeAPIRouteEndpoint(endpoint, new Request("https://app.example.com/api/invalid")),
    ).rejects.toThrow("must return an object, true, false, or a Response");
  });

  it("rejects duplicate and unsafe context keys", async () => {
    const duplicate = createEndpoint(
      {
        method: "GET",
        middleware: [() => ({ session: { id: "one" } }), () => ({ session: { id: "two" } })],
      },
      () => ({ ok: true }),
    );

    await expect(
      invokeAPIRouteEndpoint(duplicate, new Request("https://app.example.com/api/duplicate")),
    ).rejects.toThrow('cannot replace the existing context key "session"');

    const unsafeContext = Object.create(null) as Record<string, unknown>;
    unsafeContext.__proto__ = "unsafe";
    const unsafe = createEndpoint(
      {
        method: "GET",
        middleware: [() => unsafeContext],
      },
      () => ({ ok: true }),
    );

    await expect(
      invokeAPIRouteEndpoint(unsafe, new Request("https://app.example.com/api/unsafe")),
    ).rejects.toThrow('unsafe context key "__proto__"');
  });

  it("copies the middleware list when the endpoint is created", async () => {
    const first = vi.fn(() => true as const);
    const addedLater = vi.fn(() => false as const);
    const middleware: Array<() => boolean> = [first];
    const endpoint = createEndpoint({ method: "GET", middleware }, () => ({ ok: true }));
    middleware.push(addedLater);

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/stable"),
    );

    expect(response.status).toBe(200);
    expect(first).toHaveBeenCalledOnce();
    expect(addedLater).not.toHaveBeenCalled();
  });

  it("preserves middleware context inference in method helpers", async () => {
    const endpoint = POST(
      {
        body: z.object({ name: z.string() }),
        middleware: [withSession],
      },
      ({ body, context }) => {
        expectTypeOf(body.name).toEqualTypeOf<string>();
        expectTypeOf(context.session).toEqualTypeOf<Session>();
        return { name: body.name, userId: context.session.user.id };
      },
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "user-2",
        },
        body: JSON.stringify({ name: "Farm" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({ name: "Farm", userId: "user-2" });
  });

  it("runs the same middleware for direct server endpoint calls", async () => {
    const endpoint = createEndpoint(
      "/api/direct",
      {
        method: "GET",
        middleware: [() => ({ source: "middleware" as const })],
      },
      ({ context }) => ({ source: context.source }),
    );

    await expect(endpoint()).resolves.toEqual({ source: "middleware" });
  });
});
