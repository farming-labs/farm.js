// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { redirect } from "../navigation";
import {
  _describeServerFunction,
  _invokeServerFunction,
  createServerFn,
  ServerFnFailure,
} from "../server-fn";
import { createServerQuery } from "../server-query";

const request = () => new Request("http://farm.test/api/mcp", { method: "POST" });

describe("server functions invoked outside the action transport", () => {
  it("describes schemas and metadata without exposing the handler", () => {
    const input = z.object({ email: z.string() });
    const submit = createServerFn({ input, mcp: { name: "submit" }, handler: () => null });
    const plans = createServerQuery({ key: () => ["plans"], handler: () => [] });

    const described = _describeServerFunction(submit)!;
    expect(described).toEqual({
      kind: "action",
      input,
      output: undefined,
      mcp: { name: "submit" },
    });
    expect(Object.isFrozen(described)).toBe(true);
    expect(described).not.toHaveProperty("run");
    expect(_describeServerFunction(plans)).toMatchObject({ kind: "query", mcp: undefined });
    expect(_describeServerFunction(() => null)).toBeUndefined();
    expect(_describeServerFunction({})).toBeUndefined();
  });

  it("keeps direct calls unchanged: input errors are the validator's own error", async () => {
    const submit = createServerFn({
      input: z.object({ email: z.string().email() }),
      handler: () => null,
    });

    await expect(submit({ email: "nope" })).rejects.toBeInstanceOf(z.ZodError);
  });

  it("reports which phase failed", async () => {
    const handler = vi.fn(({ input, error }) => {
      if (input.seat === "taken") error("SOLD_OUT", { seat: input.seat });
      if (input.seat === "moved") redirect("/seats/new");
      if (input.seat === "boom") throw new Error("private detail");
      return { booked: input.seat };
    });
    const book = createServerFn({
      input: z.object({ seat: z.string().min(2) }),
      errors: { SOLD_OUT: { status: 409, data: z.object({ seat: z.string() }) } },
      handler,
    });

    expect(await _invokeServerFunction(book, { seat: "a1" }, request())).toEqual({
      ok: true,
      data: { booked: "a1" },
    });

    const input = await _invokeServerFunction(book, { seat: "" }, request());
    expect(input).toMatchObject({ ok: false, reason: "input" });
    expect(input.ok === false && input.reason === "input" && input.error).toBeInstanceOf(
      z.ZodError,
    );
    expect(handler).toHaveBeenCalledTimes(1);

    const failure = await _invokeServerFunction(book, { seat: "taken" }, request());
    expect(failure).toMatchObject({ ok: false, reason: "failure" });
    expect(failure.ok === false && failure.reason === "failure" && failure.failure).toBeInstanceOf(
      ServerFnFailure,
    );

    expect(await _invokeServerFunction(book, { seat: "moved" }, request())).toEqual({
      ok: false,
      reason: "redirect",
      url: "/seats/new",
      status: 307,
    });

    const error = await _invokeServerFunction(book, { seat: "boom" }, request());
    expect(error).toMatchObject({ ok: false, reason: "error" });
  });

  it("reports an exception thrown while parsing input as an error, not an input failure", async () => {
    const secret = new Error("connect postgres://admin:hunter2@db.internal failed");
    const refined = createServerFn({
      input: z.object({ slug: z.string() }).refine(() => {
        throw secret;
      }),
      handler: () => null,
    });
    const parseOnly = createServerFn({
      input: {
        parse: () => {
          throw secret;
        },
      },
      handler: () => null,
    });

    for (const fn of [refined, parseOnly]) {
      expect(await _invokeServerFunction(fn, { slug: "farm" }, request())).toEqual({
        ok: false,
        reason: "error",
        error: secret,
      });
    }

    const issues = [{ path: ["slug"], message: "Slug is taken" }];
    const thrownIssues = createServerFn({
      input: {
        parse: () => {
          throw Object.assign(new Error("Slug is taken"), { issues });
        },
      },
      handler: () => null,
    });
    expect(await _invokeServerFunction(thrownIssues, {}, request())).toMatchObject({
      ok: false,
      reason: "input",
    });
  });

  it("passes the caller's request to middleware and handlers", async () => {
    const whoami = createServerFn({
      handler: ({ request }) => request?.headers.get("authorization") ?? null,
    });
    const caller = new Request("http://farm.test/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer agent" },
    });

    expect(await _invokeServerFunction(whoami, undefined, caller)).toEqual({
      ok: true,
      data: "Bearer agent",
    });
  });

  it("resolves a query to its data, not the client cache envelope", async () => {
    const plans = createServerQuery({
      input: z.object({ tier: z.string() }),
      key: ({ input }) => ["plans", input.tier],
      handler: ({ input }) => [{ tier: input.tier }],
    });

    expect(await _invokeServerFunction(plans, { tier: "team" }, request())).toEqual({
      ok: true,
      data: [{ tier: "team" }],
    });
    expect(await _invokeServerFunction(plans, { tier: 1 }, request())).toMatchObject({
      ok: false,
      reason: "input",
    });
  });

  it("rejects values that are not server functions", async () => {
    await expect(_invokeServerFunction(() => null, {}, request())).rejects.toThrow(
      /createServerFn or createServerQuery/,
    );
  });
});
