import { describe, expect, it } from "vitest";
import {
  isFarmPreviewDeploymentEnvironment,
  isFarmProductionDeploymentEnvironment,
  resolveFarmPreviewDeployment,
} from "../deployment-environment";
import {
  FARM_PREVIEW_ROBOTS_TAG,
  applyFarmPreviewRobotsTag,
  resolveFarmNoindexPreviews,
} from "../preview-noindex";

describe("preview deployment detection", () => {
  it("reads each provider's explicit preview signal", () => {
    const previews = [
      { FARM_PREVIEW: "1" },
      { FARM_PREVIEW: "true" },
      { VERCEL_ENV: "preview" },
      { VERCEL_ENV: "Preview", VERCEL_TARGET_ENV: "staging" },
      { NETLIFY: "true", CONTEXT: "deploy-preview" },
      { NETLIFY: "true", CONTEXT: "branch-deploy" },
      { IS_PULL_REQUEST: "true" },
    ];
    for (const env of previews) expect(isFarmPreviewDeploymentEnvironment(env)).toBe(true);

    const notPreviews = [
      {},
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "development" },
      { NETLIFY: "true", CONTEXT: "production" },
      { NETLIFY: "true", CONTEXT: "dev" },
      // CONTEXT is a generic name; only Netlify's is trusted.
      { CONTEXT: "deploy-preview" },
      // Cloudflare Pages sets the branch for production and previews alike.
      { CF_PAGES: "1", CF_PAGES_BRANCH: "feature" },
      { IS_PULL_REQUEST: "false" },
      { FARM_PREVIEW: "0", VERCEL_ENV: "preview" },
      { FARM_PREVIEW: "false", NETLIFY: "true", CONTEXT: "deploy-preview" },
    ];
    for (const env of notPreviews) expect(isFarmPreviewDeploymentEnvironment(env)).toBe(false);
    expect(isFarmPreviewDeploymentEnvironment(undefined)).toBe(false);
  });

  it("carries a preview build into the server unless FARM_PREVIEW says otherwise", () => {
    // Netlify sets CONTEXT only while building, so the built server keeps its answer.
    expect(resolveFarmPreviewDeployment({}, true)).toBe(true);
    expect(resolveFarmPreviewDeployment(undefined, true)).toBe(true);
    expect(resolveFarmPreviewDeployment({ FARM_PREVIEW: "0" }, true)).toBe(false);
    expect(resolveFarmPreviewDeployment({ VERCEL_ENV: "preview" }, false)).toBe(true);
    expect(resolveFarmPreviewDeployment({ VERCEL_ENV: "production" }, false)).toBe(false);
  });

  it("keeps telemetry's production check", () => {
    expect(isFarmProductionDeploymentEnvironment({})).toBe(true);
    expect(isFarmProductionDeploymentEnvironment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isFarmProductionDeploymentEnvironment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isFarmProductionDeploymentEnvironment({ VERCEL_TARGET_ENV: "staging" })).toBe(false);
    expect(isFarmProductionDeploymentEnvironment({ NETLIFY: "1", CONTEXT: "dev" })).toBe(false);
    expect(isFarmProductionDeploymentEnvironment({ CONTEXT: "dev" })).toBe(true);
    expect(isFarmProductionDeploymentEnvironment({ IS_PULL_REQUEST: "true" })).toBe(false);
  });
});

describe("agent.noindexPreviews", () => {
  it("validates the option", () => {
    expect(resolveFarmNoindexPreviews(undefined)).toBe(false);
    expect(resolveFarmNoindexPreviews(true)).toBe(true);
    expect(() => resolveFarmNoindexPreviews("true")).toThrow(
      "agent.noindexPreviews must be a boolean.",
    );
  });

  it("sets X-Robots-Tag on mutable and immutable responses", async () => {
    const page = new Response("<p>hi</p>", { headers: { "X-Robots-Tag": "index" } });
    expect(applyFarmPreviewRobotsTag(page)).toBe(page);
    expect(page.headers.get("x-robots-tag")).toBe(FARM_PREVIEW_ROBOTS_TAG);

    const redirect = Response.redirect("https://acme.test/next", 307);
    const tagged = applyFarmPreviewRobotsTag(redirect);
    expect(tagged.status).toBe(307);
    expect(tagged.headers.get("location")).toBe("https://acme.test/next");
    expect(tagged.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
