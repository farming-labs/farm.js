// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  FARM_DEPLOYMENT_COOKIE,
  FARM_DEPLOYMENT_ID_HEADER,
  FARM_DEPLOYMENT_MISMATCH_CODE,
  FARM_DEPLOYMENT_MISMATCH_HEADER,
  FarmDeploymentMismatchError,
  createFarmDeploymentCookie,
  createFarmDeploymentMismatchError,
  createFarmDeploymentMismatchResponse,
  createFarmDeploymentRequestHeaders,
  getFarmDeploymentMismatch,
  getFarmRequestDeploymentId,
  isFarmDeploymentMismatchResponse,
  normalizeFarmDeploymentId,
  withFarmDeploymentResponse,
} from "../deployment";

describe("deployment skew protocol", () => {
  it("normalizes valid deployment IDs and rejects unsafe header values", () => {
    expect(normalizeFarmDeploymentId("  release-abc123  ")).toBe("release-abc123");
    expect(() => normalizeFarmDeploymentId("")).toThrow("non-empty string");
    expect(() => normalizeFarmDeploymentId("release\r\nx-injected: yes")).toThrow(
      "without control bytes",
    );
    expect(() => normalizeFarmDeploymentId("x".repeat(201))).toThrow("at most 200 characters");
  });

  it("adds the deployment header without replacing caller headers", () => {
    const headers = createFarmDeploymentRequestHeaders("release-2", {
      Accept: "text/x-component",
    });

    expect(headers.get(FARM_DEPLOYMENT_ID_HEADER)).toBe("release-2");
    expect(headers.get("accept")).toBe("text/x-component");
  });

  it("prefers the explicit request header and only uses cookies for unsafe methods", () => {
    const cookie = `${FARM_DEPLOYMENT_COOKIE}=release-cookie`;
    const headerRequest = new Request("https://farm.test/action", {
      method: "POST",
      headers: {
        Cookie: cookie,
        [FARM_DEPLOYMENT_ID_HEADER]: "release-header",
      },
    });
    const postRequest = new Request("https://farm.test/action", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const getRequest = new Request("https://farm.test/page", {
      headers: { Cookie: cookie },
    });

    expect(getFarmRequestDeploymentId(headerRequest)).toBe("release-header");
    expect(getFarmRequestDeploymentId(postRequest)).toBe("release-cookie");
    expect(getFarmRequestDeploymentId(getRequest)).toBeUndefined();
  });

  it("detects stale clients without rejecting missing or matching IDs", () => {
    const stale = new Request("https://farm.test/action", {
      method: "POST",
      headers: { [FARM_DEPLOYMENT_ID_HEADER]: "release-1" },
    });
    const current = new Request("https://farm.test/action", {
      method: "POST",
      headers: { [FARM_DEPLOYMENT_ID_HEADER]: "release-2" },
    });
    const unversioned = new Request("https://farm.test/action", { method: "POST" });

    expect(getFarmDeploymentMismatch(stale, "release-2")).toEqual({
      clientDeploymentId: "release-1",
      serverDeploymentId: "release-2",
    });
    expect(getFarmDeploymentMismatch(current, "release-2")).toBeNull();
    expect(getFarmDeploymentMismatch(unversioned, "release-2")).toBeNull();
  });

  it("returns an explicit no-store conflict response for stale requests", async () => {
    const response = createFarmDeploymentMismatchResponse({
      clientDeploymentId: "release-1",
      serverDeploymentId: "release-2",
    });

    expect(response.status).toBe(409);
    expect(response.headers.get(FARM_DEPLOYMENT_ID_HEADER)).toBe("release-2");
    expect(response.headers.get(FARM_DEPLOYMENT_MISMATCH_HEADER)).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: FARM_DEPLOYMENT_MISMATCH_CODE,
    });
  });

  it("marks responses and writes an HttpOnly deployment cookie", () => {
    const response = withFarmDeploymentResponse(new Response("ok"), "release-2", {
      setCookie: true,
      cookiePath: "/shop",
      secureCookie: true,
    });

    expect(response.headers.get(FARM_DEPLOYMENT_ID_HEADER)).toBe("release-2");
    expect(response.headers.get("set-cookie")).toContain(
      `${FARM_DEPLOYMENT_COOKIE}=release-2; Path=/shop; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(createFarmDeploymentCookie("release/a", "app")).toContain(
      `${FARM_DEPLOYMENT_COOKIE}=release%2Fa; Path=/app`,
    );
  });

  it("creates a non-retryable client error from mismatch responses", () => {
    const response = createFarmDeploymentMismatchResponse({
      clientDeploymentId: "release-1",
      serverDeploymentId: "release-2",
    });

    expect(isFarmDeploymentMismatchResponse(response, "release-1")).toBe(true);
    const error = createFarmDeploymentMismatchError(response, "release-1");
    expect(error).toBeInstanceOf(FarmDeploymentMismatchError);
    expect(error).toMatchObject({
      code: FARM_DEPLOYMENT_MISMATCH_CODE,
      clientDeploymentId: "release-1",
      serverDeploymentId: "release-2",
      retryable: false,
    });
  });
});
