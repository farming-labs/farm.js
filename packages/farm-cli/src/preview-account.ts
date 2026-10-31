import { logger } from "@farm.js/core/internal/cli-runtime";
import { loadPreviewEnvironment } from "./preview";
import {
  PreviewApiKeyDeclinedError,
  formatPreviewExpiration,
  previewSignInStatus,
  signInToPreviewGateway,
  signOutOfPreviewGateway,
} from "./preview-auth";
import { resolvePreviewGatewayUrl } from "./preview-gateway";

export interface PreviewAccountOptions {
  root?: string;
  configPath?: string;
  gatewayUrl?: string;
}

const MODE_LABELS = {
  github: "GitHub sign-in",
  infrastructure: "Farm.js Infrastructure sign-in",
  none: "no sign-in required",
} as const;

/** farm login */
export async function loginToFarmPreview(options: PreviewAccountOptions = {}) {
  await loadPreviewEnvironment(options.root, options.configPath);
  try {
    await signInToPreviewGateway(resolvePreviewGatewayUrl(options.gatewayUrl));
  } catch (error) {
    // Saying no is a choice, not a failure.
    if (!(error instanceof PreviewApiKeyDeclinedError)) throw error;
    logger.info(error.message);
  }
}

/** farm logout. Only this machine forgets the key; it stays valid in Farm.js Infrastructure. */
export async function logoutOfFarmPreview(options: PreviewAccountOptions = {}) {
  await loadPreviewEnvironment(options.root, options.configPath);
  const gatewayUrl = resolvePreviewGatewayUrl(options.gatewayUrl);
  if (await signOutOfPreviewGateway(gatewayUrl)) {
    logger.success(`Signed out of ${gatewayUrl} on this machine.`);
  } else {
    logger.info(`No saved sign-in for ${gatewayUrl}.`);
  }
  if (process.env.FARMJS_API_KEY?.trim()) {
    logger.info(
      "FARMJS_API_KEY is still set, so farm preview uses it where the gateway accepts it.",
    );
  }
}

/** farm whoami. Resolves false when farm preview would need a browser sign-in. */
export async function whoamiFarmPreview(options: PreviewAccountOptions = {}): Promise<boolean> {
  await loadPreviewEnvironment(options.root, options.configPath);
  const status = await previewSignInStatus(resolvePreviewGatewayUrl(options.gatewayUrl));
  logger.info(`Preview gateway: ${status.gatewayUrl} (${MODE_LABELS[status.mode]})`);
  const using = status.using;
  if (status.mode === "none") {
    logger.info("Previews here don't need an account.");
  } else if (!using) {
    logger.info(
      // When a key is set but unusable, the line below says why instead.
      `Not signed in. Run farm login${status.mode === "infrastructure" && !status.ignoredKey ? ", or set FARMJS_API_KEY" : ""}.`,
    );
  } else if (using.source === "FARMJS_API_KEY") {
    logger.info(`Using FARMJS_API_KEY (${using.hint}).`);
  } else if (using.source === "FARM_PREVIEW_TOKEN") {
    logger.info(
      `Using FARM_PREVIEW_TOKEN, which is deprecated${status.mode === "infrastructure" ? ". Set FARMJS_API_KEY instead" : ""}.`,
    );
  } else if (using.hint) {
    // farm login's key starts previews; analytics needs a Site analytics key.
    logger.info(`Signed in with a saved API key for previews (${using.hint}).`);
  } else {
    const until = using.expiresAt ? `, until ${formatPreviewExpiration(using.expiresAt)}` : "";
    logger.info(`Signed in as ${using.login ?? "your saved account"}${until}.`);
  }
  if (status.savedOverridden) {
    logger.info(`A saved sign-in also exists; ${using?.source} takes precedence.`);
  }
  if (status.ignoredKey) logger.info(`FARMJS_API_KEY is set but not used: ${status.ignoredKey}.`);
  return status.mode === "none" || !!using;
}
