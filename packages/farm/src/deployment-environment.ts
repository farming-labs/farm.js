/**
 * What a hosting provider says about the current deployment, read from the
 * environment variables it sets. Production-site telemetry and
 * `agent.noindexPreviews` both read these, with opposite fallbacks: telemetry
 * treats a deployment it cannot classify as production, and noindexPreviews
 * treats it as not a preview. Either way an unknown setup keeps its default
 * behavior instead of being guessed at.
 *
 * Cloudflare Pages is deliberately absent: it exposes `CF_PAGES_BRANCH` for both
 * production and preview deployments and no environment flag that distinguishes
 * them, so there is nothing here that could be read without guessing. Its
 * preview URLs already carry `X-Robots-Tag: noindex`.
 */

type FarmDeploymentEnv = Readonly<Record<string, string | undefined>>;

/**
 * Only a provider's production environment represents a production site;
 * preview, branch, and development deployments are not. A deployment whose
 * provider exposes no environment metadata counts as production, so self-hosted
 * sites keep reporting.
 */
export function isFarmProductionDeploymentEnvironment(
  env: FarmDeploymentEnv = process.env,
): boolean {
  // Vercel exposes the deployment environment at build and runtime.
  const environment = normalizeEnvironment(env.VERCEL_ENV);
  const targetEnvironment = normalizeEnvironment(env.VERCEL_TARGET_ENV);
  if (environment && environment !== "production") return false;
  if (targetEnvironment && targetEnvironment !== "production") return false;

  // Netlify: CONTEXT is production | deploy-preview | branch-deploy | dev.
  // CONTEXT is a generic name, so it is only trusted when NETLIFY marks the
  // build as Netlify's.
  if (isTrue(env.NETLIFY)) {
    const context = normalizeEnvironment(env.CONTEXT);
    if (context && context !== "production") return false;
  }

  // Render marks pull-request preview services.
  if (isTrue(env.IS_PULL_REQUEST)) return false;

  return true;
}

/**
 * Whether the environment marks this as a preview deployment. `FARM_PREVIEW`
 * decides when set (`1`/`true` or `0`/`false`); otherwise a provider has to say
 * so explicitly:
 *
 * - Vercel: `VERCEL_ENV=preview`, which custom environments such as staging use too.
 * - Netlify: `CONTEXT=deploy-preview` or `branch-deploy`, with `NETLIFY` set.
 *   Netlify sets these at build time only.
 * - Render: `IS_PULL_REQUEST=true`.
 *
 * Local development is not a preview deployment.
 */
export function isFarmPreviewDeploymentEnvironment(env: FarmDeploymentEnv | undefined): boolean {
  return resolveFarmPreviewDeployment(env, false);
}

/**
 * Preview status for a running server: the runtime environment, or the
 * environment it was built in. Netlify exposes its deploy context only to the
 * build, so the build's answer is carried into the server bundle. An explicit
 * `FARM_PREVIEW` at runtime still wins over the build.
 */
export function resolveFarmPreviewDeployment(
  env: FarmDeploymentEnv | undefined,
  builtAsPreview: boolean,
): boolean {
  const explicit = env?.FARM_PREVIEW;
  if (isTrue(explicit)) return true;
  if (isFalse(explicit)) return false;
  if (builtAsPreview || !env) return builtAsPreview;

  if (normalizeEnvironment(env.VERCEL_ENV) === "preview") return true;
  if (isTrue(env.NETLIFY)) {
    const context = normalizeEnvironment(env.CONTEXT);
    if (context === "deploy-preview" || context === "branch-deploy") return true;
  }
  return isTrue(env.IS_PULL_REQUEST);
}

function normalizeEnvironment(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function isTrue(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function isFalse(value: string | undefined): boolean {
  return value !== undefined && ["0", "false", "no", "off"].includes(value.toLowerCase());
}
