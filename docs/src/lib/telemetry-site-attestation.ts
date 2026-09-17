import {
  FARM_PRODUCTION_SITE_ATTESTATION_EVENT_TYPE,
  FARM_PRODUCTION_SITE_ATTESTATION_PATH,
  FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME,
  FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION,
  normalizeFarmProductionSiteOrigin,
  type FarmProductionSiteAttestation,
} from "../../../packages/farm/src/product-telemetry";
import { createNodeImageFetcher } from "../../../packages/farm/src/image-sharp";

const MAX_ATTESTATION_BYTES = 4 * 1024;
const ATTESTATION_TIMEOUT_MS = 2_000;
const SAFE_DETAIL_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;
const ATTESTATION_KEYS = [
  "deployTarget",
  "eventType",
  "packageName",
  "packageVersion",
  "renderer",
  "schemaVersion",
] as const;

type VerifyFarmProductionSiteAttestationOptions = {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

const fetchPublicOrigin = createNodeImageFetcher({ dangerouslyAllowLocalIP: false });

export async function verifyFarmProductionSiteAttestation(
  siteUrl: string,
  options: VerifyFarmProductionSiteAttestationOptions = {},
): Promise<FarmProductionSiteAttestation | undefined> {
  const normalizedOrigin = normalizeFarmProductionSiteOrigin(siteUrl);
  if (!normalizedOrigin || normalizedOrigin !== siteUrl) return undefined;

  const endpoint = new URL(FARM_PRODUCTION_SITE_ATTESTATION_PATH, `${normalizedOrigin}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? ATTESTATION_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const response = await (options.fetch ?? fetchPublicOrigin)(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
    ) {
      await cancelResponse(response);
      return undefined;
    }

    const text = await readResponseTextWithLimit(response, MAX_ATTESTATION_BYTES);
    if (text === undefined) return undefined;

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return undefined;
    }
    return parseAttestation(value);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAttestation(value: unknown): FarmProductionSiteAttestation | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== ATTESTATION_KEYS.length ||
    keys.some((key, index) => key !== ATTESTATION_KEYS[index])
  ) {
    return undefined;
  }
  if (
    record.schemaVersion !== FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION ||
    record.eventType !== FARM_PRODUCTION_SITE_ATTESTATION_EVENT_TYPE ||
    record.packageName !== FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME ||
    typeof record.packageVersion !== "string" ||
    !SAFE_DETAIL_PATTERN.test(record.packageVersion) ||
    typeof record.renderer !== "string" ||
    !SAFE_DETAIL_PATTERN.test(record.renderer) ||
    typeof record.deployTarget !== "string" ||
    !SAFE_DETAIL_PATTERN.test(record.deployTarget)
  ) {
    return undefined;
  }
  return record as unknown as FarmProductionSiteAttestation;
}

async function readResponseTextWithLimit(
  response: Response,
  maximumBytes: number,
): Promise<string | undefined> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await cancelResponse(response);
    return undefined;
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort socket cleanup for rejected attestations.
  }
}
