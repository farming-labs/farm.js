import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseRouteSchema, toPublicValidationIssues } from "../api/route-schema";

describe("parseRouteSchema", () => {
  it("runs asynchronous Zod refinements and transforms once", async () => {
    const refine = vi.fn(async (value: string) => value !== "blocked");
    const transform = vi.fn((value: string) => value.length);
    const schema = z.object({ query: z.string().refine(refine).transform(transform) });

    await expect(parseRouteSchema(schema, { query: "farm" })).resolves.toEqual({ query: 4 });
    expect(refine).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledTimes(1);
    await expect(parseRouteSchema(schema, { query: "blocked" })).rejects.toHaveProperty("issues");
    expect(refine).toHaveBeenCalledTimes(2);
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("retains asynchronous Standard Schema validation and issues", async () => {
    const validate = vi
      .fn()
      .mockResolvedValueOnce({ value: "parsed" })
      .mockResolvedValueOnce({ issues: [{ message: "Invalid value" }] });
    const schema = { "~standard": { validate } };
    await expect(parseRouteSchema(schema, "input")).resolves.toBe("parsed");
    await expect(parseRouteSchema(schema, "bad")).rejects.toMatchObject({
      issues: [{ message: "Invalid value" }],
    });
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("supports parse-only validators and preserves thrown errors", async () => {
    const error = new Error("Invalid input");
    const parse = vi
      .fn()
      .mockReturnValueOnce(42)
      .mockImplementationOnce(() => {
        throw error;
      });
    await expect(parseRouteSchema({ parse }, "42")).resolves.toBe(42);
    await expect(parseRouteSchema({ parse }, "bad")).rejects.toBe(error);
  });

  it("rejects unsupported validators", async () => {
    await expect(parseRouteSchema({}, {})).rejects.toThrow("Route validators must implement");
  });
});

describe("toPublicValidationIssues", () => {
  it("keeps type and refinement messages but never quotes an expected value", () => {
    const result = z
      .object({
        token: z.literal("Bearer s3cr3t"),
        plan: z.enum(["internal-x9", "free"]),
        count: z.number(),
        slug: z.string().refine(() => false, "Slug is taken"),
      })
      .safeParse({ token: "Bearer guess", plan: "pro", count: "1", slug: "x" });
    const issues = toPublicValidationIssues(result.error);
    expect(JSON.stringify(issues)).not.toMatch(/s3cr3t|internal-x9/);
    expect(issues.find((issue) => issue.path[0] === "token")?.message).toBe("Invalid value");
    expect(issues.find((issue) => issue.path[0] === "plan")?.message).toBe("Invalid value");
    expect(issues.find((issue) => issue.path[0] === "count")?.message).toMatch(/expected number/);
    expect(issues.find((issue) => issue.path[0] === "slug")?.message).toBe("Slug is taken");
  });
});
