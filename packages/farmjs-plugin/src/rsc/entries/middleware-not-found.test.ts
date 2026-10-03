import { describe, expect, it } from "vitest";
import {
  applyProductionMiddlewareHeaders,
  createProductionMiddlewareRunner,
} from "@farm.js/core/internal/production-runtime";
import { notFound, redirect } from "@farm.js/core/navigation";
import type { EntryContext } from "../types.js";
import { generateRscEntry, generateRscMiddlewareResultHandling } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1_000_000 },
  deploymentId: "middleware-not-found-test",
  debug: false,
};

// Runs the entry's generated result handler against core's real runner, so the
// entry and the runner's result contract cannot drift apart unnoticed.
function middlewareStep(middleware: (ctx: any) => unknown) {
  const entry = generateRscEntry(context);
  const resultHandling = generateRscMiddlewareResultHandling();
  expect(entry).toContain(resultHandling);

  const runner = createProductionMiddlewareRunner({
    // A default export receives Farm's ctx, whose headers reach the response.
    modules: [{ path: "/account", module: { default: middleware } }],
  });
  const step = new Function(
    "request",
    "executeMiddleware",
    "applyProductionMiddlewareHeaders",
    `return (async () => {
      const middlewareResult = await executeMiddleware(request);
      ${resultHandling}
      return "rendered";
    })();`,
  );
  return (url: string) =>
    step(
      new Request(url),
      (request: Request) => runner(request),
      applyProductionMiddlewareHeaders,
    ) as Promise<Response | "rendered">;
}

describe("generated RSC middleware step", () => {
  it("answers notFound() with a 404 instead of rendering the page", async () => {
    const result = await middlewareStep((ctx) => {
      ctx.headers.set("x-guard", "account");
      notFound();
    })("https://app.test/account/9");

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-guard")).toBe("account");
    expect(await response.text()).toBe("Not Found");
  });

  it("still answers redirect() with the middleware's response", async () => {
    const result = await middlewareStep(() => redirect("/sign-in"))("https://app.test/account");

    expect((result as Response).status).toBe(307);
    expect((result as Response).headers.get("location")).toBe("/sign-in");
  });

  it("renders the page when middleware lets the request through", async () => {
    const result = await middlewareStep((ctx) => {
      ctx.headers.set("x-guard", "account");
    })("https://app.test/account/9");

    expect(result).toBe("rendered");
  });
});
