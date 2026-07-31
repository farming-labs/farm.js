import { getFarmAuthRequest, getFarmAuthRuntime } from "./runtime.js";
import type { FarmAuthLookupOptions, FarmAuthSession, FarmAuthUser } from "./types.js";

async function readSession(options: FarmAuthLookupOptions = {}): Promise<FarmAuthSession | null> {
  const request = getFarmAuthRequest(options.request);
  const runtime = await getFarmAuthRuntime();
  const session = (await runtime.api.getSession({
    headers: request.headers,
  })) as FarmAuthSession | null;

  if (!session && options.required) {
    throw Response.json(
      {
        error: "Authentication required",
        code: "FARM_AUTH_REQUIRED",
      },
      { status: 401 },
    );
  }

  return session;
}

/**
 * Farm Auth server helpers. Use `required: true` when anonymous access should
 * immediately return a 401 response.
 */
function session(options: FarmAuthLookupOptions & { required: true }): Promise<FarmAuthSession>;
function session(options?: FarmAuthLookupOptions): Promise<FarmAuthSession | null>;
function session(options?: FarmAuthLookupOptions): Promise<FarmAuthSession | null> {
  return readSession(options);
}

function user(options: FarmAuthLookupOptions & { required: true }): Promise<FarmAuthUser>;
function user(options?: FarmAuthLookupOptions): Promise<FarmAuthUser | null>;
async function user(options?: FarmAuthLookupOptions): Promise<FarmAuthUser | null> {
  return (await readSession(options))?.user ?? null;
}

export const auth = { session, user };

export type {
  FarmAuthLookupOptions,
  FarmAuthSession,
  FarmAuthSessionData,
  FarmAuthUser,
} from "./types.js";
