import type { ConvexSiteToken, ConvexTokenReader } from "./types.js";

function isTokenPayload(value: unknown): value is { token: string } {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "token") === "string"
  );
}

async function readTokenPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Exchange the visitor's cookie for a Convex token at a path on the Convex site URL. */
export function createSiteTokenReader(
  siteToken: ConvexSiteToken,
  siteURL: string,
): ConvexTokenReader {
  return async (request) => {
    const cookie = request.headers.get("cookie");
    if (!cookie || (siteToken.cookie && !cookie.includes(siteToken.cookie))) return undefined;
    const response = await fetch(new URL(siteToken.path, siteURL), {
      headers: { cookie, "accept-encoding": "identity" },
    });
    if (!response.ok) return undefined;
    const payload = await readTokenPayload(response);
    return isTokenPayload(payload) ? payload.token : undefined;
  };
}
