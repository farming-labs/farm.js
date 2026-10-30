import type { ConvexDeploymentURLs, ConvexIntegrationInput } from "./types.js";

const CLOUD_SUFFIX = ".convex.cloud";
const SITE_SUFFIX = ".convex.site";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);

const URL_ENVIRONMENT_NAMES = ["CONVEX_URL", "VITE_CONVEX_URL"];
const SITE_URL_ENVIRONMENT_NAMES = ["CONVEX_SITE_URL", "VITE_CONVEX_SITE_URL"];

export function hasDeploymentURL(input: ConvexIntegrationInput): boolean {
  return Boolean(input.url ?? readEnvironmentValue(URL_ENVIRONMENT_NAMES));
}

export function readEnvironmentValue(names: readonly string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find((value) => Boolean(value));
}

function parseURL(value: string, name: string): URL {
  if (!URL.canParse(value)) {
    throw new Error(`Convex integration: ${name} is not a valid URL (received "${value}").`);
  }
  return new URL(value);
}

function checkDeploymentURL(url: URL): void {
  if (url.hostname.endsWith(SITE_SUFFIX)) {
    throw new Error(
      `Convex integration: CONVEX_URL points at the HTTP actions URL (${SITE_SUFFIX}). Use the deployment URL ending in ${CLOUD_SUFFIX}, and put the ${SITE_SUFFIX} URL in CONVEX_SITE_URL.`,
    );
  }
}

function checkSiteURL(url: URL): void {
  if (url.hostname.endsWith(CLOUD_SUFFIX)) {
    throw new Error(
      `Convex integration: CONVEX_SITE_URL points at the deployment URL (${CLOUD_SUFFIX}). Use the HTTP actions URL ending in ${SITE_SUFFIX}.`,
    );
  }
}

export function deriveSiteURL(url: URL): string | undefined {
  if (url.hostname.endsWith(CLOUD_SUFFIX)) {
    return `${url.protocol}//${url.hostname.slice(0, -CLOUD_SUFFIX.length)}${SITE_SUFFIX}`;
  }
  if (!LOCAL_HOSTS.has(url.hostname) || !url.port) return undefined;
  return `${url.protocol}//${url.hostname}:${Number(url.port) + 1}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveURL(input: ConvexIntegrationInput): URL {
  const rawURL = input.url ?? readEnvironmentValue(URL_ENVIRONMENT_NAMES);
  if (!rawURL) {
    throw new Error(
      "Convex integration requires CONVEX_URL. Run `npx convex dev` once to create a deployment and write CONVEX_URL to .env.local, or pass convex({ url }).",
    );
  }
  const url = parseURL(rawURL, "CONVEX_URL");
  checkDeploymentURL(url);
  return url;
}

function resolveSiteURL(input: ConvexIntegrationInput, url: URL): string {
  const rawSiteURL =
    input.siteURL ?? readEnvironmentValue(SITE_URL_ENVIRONMENT_NAMES) ?? deriveSiteURL(url);
  if (!rawSiteURL) {
    throw new Error(
      "Convex integration could not work out CONVEX_SITE_URL from CONVEX_URL. Set CONVEX_SITE_URL to your deployment's HTTP actions URL, or pass convex({ siteURL }).",
    );
  }
  checkSiteURL(parseURL(rawSiteURL, "CONVEX_SITE_URL"));
  return rawSiteURL;
}

export function resolveDeploymentURLs(input: ConvexIntegrationInput): ConvexDeploymentURLs {
  const url = resolveURL(input);
  return {
    url: trimTrailingSlash(url.href),
    siteURL: trimTrailingSlash(resolveSiteURL(input, url)),
  };
}
