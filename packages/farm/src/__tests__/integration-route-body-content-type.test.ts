// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineIntegration, dispatchIntegrationRequest, integrationRoute } from "../integrations";

const crossSite = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };

function billing() {
  const refund = vi.fn((_chargeId: string) => undefined);
  const integration = defineIntegration({
    category: "payment",
    type: "body-content-type",
    instance: {},
    routes: [
      integrationRoute.post("/api/billing/refund", {
        body: z.object({ chargeId: z.string() }),
        handler(_request, context) {
          refund(context.input.body!.chargeId);
          return Response.json({ refunded: context.input.body!.chargeId });
        },
      }),
      integrationRoute.post("/api/billing/callback", {
        bodyFormat: "form",
        body: z.object({ code: z.string() }),
        handler(_request, context) {
          refund(context.input.body!.code);
          return Response.json({ code: context.input.body!.code });
        },
      }),
    ],
  });

  return {
    refund,
    dispatch: (path: string, headers: Record<string, string>, body: BodyInit) => {
      const request = new Request(`https://farm.test${path}`, { method: "POST", headers, body });
      if (!("content-type" in headers)) request.headers.delete("content-type");
      return dispatchIntegrationRequest(
        { integration, config: {}, isDev: false, isProd: true },
        request,
      );
    },
  };
}

describe("integration route body content types", () => {
  it("refuses a cross-site text/plain body instead of reading it as JSON", async () => {
    const { dispatch, refund } = billing();

    // A page on another site sends text/plain with the visitor's cookies and no CORS preflight.
    const response = await dispatch(
      "/api/billing/refund",
      { ...crossSite, "content-type": "text/plain" },
      JSON.stringify({ chargeId: "ch_pwned" }),
    );

    expect(response?.status).toBe(415);
    await expect(response?.json()).resolves.toEqual({
      error: "Unsupported Media Type",
      message: expect.stringContaining('bodyFormat: "form"'),
    });
    expect(refund).not.toHaveBeenCalled();
  });

  it("does not read a cross-site body with no content type as JSON", async () => {
    const { dispatch, refund } = billing();

    // A Blob or byte body in a no-cors fetch arrives with no Content-Type header.
    const response = await dispatch(
      "/api/billing/refund",
      crossSite,
      new TextEncoder().encode(JSON.stringify({ chargeId: "ch_pwned" })),
    );

    expect(response?.status).toBe(400);
    expect(refund).not.toHaveBeenCalled();
  });

  it("still reads JSON from the app's own pages", async () => {
    const { dispatch, refund } = billing();

    const response = await dispatch(
      "/api/billing/refund",
      { origin: "https://farm.test", "content-type": "application/json" },
      JSON.stringify({ chargeId: "ch_ok" }),
    );

    expect(response?.status).toBe(200);
    expect(refund).toHaveBeenCalledWith("ch_ok");
  });

  it.each([
    ["application/json", { "content-type": "application/json" }],
    ["text/plain", { "content-type": "text/plain; charset=UTF-8" }],
    ["no content type", {}],
  ])("still reads a JSON body declared as %s from a server caller", async (_label, headers) => {
    const { dispatch, refund } = billing();

    // Webhooks send no Origin; some (Amazon SNS) label a JSON body text/plain.
    const response = await dispatch(
      "/api/billing/refund",
      headers,
      JSON.stringify({ chargeId: "ch_hook" }),
    );

    expect(response?.status).toBe(200);
    expect(refund).toHaveBeenCalledWith("ch_hook");
  });

  it("still accepts a cross-site form post to a route that declares form input", async () => {
    const { dispatch, refund } = billing();

    // An OAuth `response_mode=form_post` callback: the provider's page posts the form.
    const response = await dispatch(
      "/api/billing/callback",
      {
        origin: "https://appleid.apple.com",
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      "code=abc",
    );

    expect(response?.status).toBe(200);
    expect(refund).toHaveBeenCalledWith("abc");
  });
});
