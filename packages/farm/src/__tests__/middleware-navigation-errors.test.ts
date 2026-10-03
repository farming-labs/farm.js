import { describe, expect, it } from "vitest";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import { notFound, permanentRedirect, redirect } from "../navigation-errors";

function runnerFor(middleware: () => void) {
  return createProductionMiddlewareRunner({
    modules: [{ path: "/account", module: { middleware } }],
  });
}

describe("production middleware navigation errors", () => {
  it("answers notFound() with the not-found page instead of failing the request", async () => {
    const result = await runnerFor(() => notFound())(new Request("https://example.com/account/9"));

    expect(result).toMatchObject({ handled: true, response: null, notFound: true });
  });

  it("answers redirect() and permanentRedirect() with a redirect response", async () => {
    const temporary = await runnerFor(() => redirect("/sign-in"))(
      new Request("https://example.com/account"),
    );
    expect(temporary.handled).toBe(true);
    expect(temporary.response?.status).toBe(307);
    expect(temporary.response?.headers.get("location")).toBe("/sign-in");

    const permanent = await runnerFor(() => permanentRedirect("/profile"))(
      new Request("https://example.com/account"),
    );
    expect(permanent.response?.status).toBe(308);
    expect(permanent.response?.headers.get("location")).toBe("/profile");
  });

  it("still fails the request for a real error", async () => {
    await expect(
      runnerFor(() => {
        throw new Error("database down");
      })(new Request("https://example.com/account")),
    ).rejects.toThrow("database down");
  });
});
