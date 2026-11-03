/**
 * Mobile session tokens (RFC 0004, 7.14): signed-in native screens.
 *
 * Web screens in the mobile shell keep the app's session cookie in the WebView cookie store.
 * Native screens (React Native, later platform screens) send no cookies and no `Origin`. After
 * the user signs in on a web screen, the shell's native code trades the WebView's cookie session
 * for a device token:
 *
 *   POST /__farm/mobile/session/challenge   cookie session        -> { nonce }
 *   POST /__farm/mobile/session             cookie session, nonce -> access + refresh token
 *   POST /__farm/mobile/session/refresh     refresh token         -> new access + refresh token
 *   POST /__farm/mobile/session/revoke      access or refresh     -> 204
 *
 * Every call must have the shape no browser can send: an `X-Farm-Mobile: <mobile.id>` header (a
 * cross-site page cannot add it without a CORS preflight) and no `Origin` or `Sec-Fetch-*`
 * header (browsers send them on every POST and on every fetch). The nonce reaches native code
 * only. What this does not prove: that the caller is the app's own binary. Any non-browser client
 * that holds the cookie can mint a token, which gives it no more than the cookie does, since a
 * token lives only as long as the cookie session it was issued from. Platform attestation (App
 * Attest, Play Integrity) over the nonce is the follow-up that proves the binary.
 *
 * Tokens are opaque (`fma1.` access, `fmr1.` refresh): a device id, a random secret, and a key.
 * Storage keeps a SHA-256 of each secret, never the secret, and the device's cookies encrypted
 * with AES-GCM under the key, which exists only inside the tokens. A storage dump yields neither
 * a usable token nor the cookies.
 *
 * A request with a valid access token, the app id it was issued to, and no browser headers runs
 * with the device's cookies in place of its own and `Origin` set to the request's origin, so
 * `auth.user()`, `protectedRoutes`, integration middleware and every origin check see the same
 * signed-in, same-origin request the WebView would send. A bearer on a request with browser
 * headers is ignored and the request keeps today's checks.
 *
 * Only apps with a `mobile` block get this plugin. Without one there is no route and no hook.
 */
import type { FarmIntegrationSession } from "../integrations";
import type { FarmPlugin, FarmPluginRuntimeBaseEvent } from "../plugin";
import { farmSecretsMatch } from "../secret-compare";
import { getStorage } from "../storage";

export const FARM_MOBILE_SESSION_PLUGIN = "farm:mobile-session";
export const FARM_MOBILE_SESSION_PATH = "/__farm/mobile/session";
export const FARM_MOBILE_APP_HEADER = "x-farm-mobile";
/** Set in the WebView cookie store at issue time; names the device so web sign-out revokes it. */
export const FARM_MOBILE_DEVICE_COOKIE = "farm_mobile";

const ACCESS_PREFIX = "fma1";
const REFRESH_PREFIX = "fmr1";
const STORAGE_NAMESPACE = "farm-mobile";
const STATE_KEY = "farm:mobile-session";
const MAX_BODY_BYTES = 8 * 1024;
/** Old refresh secrets kept per device, so a replayed one revokes the device. */
const USED_REFRESH_LIMIT = 8;
const BROWSER_HEADERS = [
  "origin",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
];
/** Reverse-DNS, like `mobile.id`: `com.example.notes`. */
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface FarmMobileSessionStore {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface FarmMobileSessionOptions {
  /** The app's basePath ("" or "/base"). The marker cookie's Path. */
  basePath?: string;
  /** The app's integrations; the first with `session()` decides who is signed in. */
  integrations: () => Record<string, unknown> | undefined;
  /** Defaults to `getStorage("farm-mobile")`. */
  storage?: () => FarmMobileSessionStore;
  /** Access token lifetime in seconds. @default 900 */
  accessTokenTtl?: number;
  /** Refresh token lifetime in seconds. @default 2592000 (30 days) */
  refreshTokenTtl?: number;
  /** Challenge nonce lifetime in seconds. @default 60 */
  nonceTtl?: number;
  /** Clock, for tests. */
  now?: () => number;
}

interface DeviceRecord {
  v: 1;
  appId: string;
  /** SHA-256 of the auth integration's session id. */
  sessionHash: string;
  createdAt: number;
  accessHash: string;
  accessExpiresAt: number;
  refreshHash: string;
  refreshExpiresAt: number;
  usedRefreshHashes: string[];
  jar: { iv: string; data: string };
}

interface ChallengeRecord {
  hash: string;
  expiresAt: number;
}

interface ParsedToken {
  deviceId: string;
  secret: string;
  key: string;
}

interface BearerState {
  deviceId: string;
  key: string;
  accessHash: string;
}

type SessionReader = (request: Request) => unknown;

// ---------------------------------------------------------------------------------------------
// Encoding and crypto (Web Crypto only: the runtime also targets edge workers)

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomToken(bytes: number): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

async function aesKey(key: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("raw", fromBase64Url(key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function sealJar(
  jar: Record<string, string>,
  key: string,
  deviceId: string,
): Promise<DeviceRecord["jar"]> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(deviceId) },
    await aesKey(key),
    encoder.encode(JSON.stringify(jar)),
  );
  return { iv: toBase64Url(iv), data: toBase64Url(new Uint8Array(data)) };
}

async function openJar(
  sealed: DeviceRecord["jar"],
  key: string,
  deviceId: string,
): Promise<Record<string, string> | null> {
  try {
    const data = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(sealed.iv), additionalData: encoder.encode(deviceId) },
      await aesKey(key),
      fromBase64Url(sealed.data),
    );
    const jar: unknown = JSON.parse(decoder.decode(data));
    if (!jar || typeof jar !== "object" || Array.isArray(jar)) return null;
    return Object.fromEntries(
      Object.entries(jar).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return null;
  }
}

function formatToken(prefix: string, token: ParsedToken): string {
  return `${prefix}.${token.deviceId}.${token.secret}.${token.key}`;
}

/** `fma1.<device>.<secret>.<key>`: 16, 32 and 32 random bytes, base64url. */
export function parseFarmMobileToken(
  value: string | null | undefined,
  kind: "access" | "refresh",
): ParsedToken | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== (kind === "access" ? ACCESS_PREFIX : REFRESH_PREFIX)) {
    return null;
  }
  const [, deviceId, secret, key] = parts as [string, string, string, string];
  if (deviceId.length !== 22 || secret.length !== 43 || key.length !== 43) return null;
  if (!BASE64URL.test(deviceId) || !BASE64URL.test(secret) || !BASE64URL.test(key)) return null;
  return { deviceId, secret, key };
}

// ---------------------------------------------------------------------------------------------
// Cookies

/** A request's cookies by name, values raw, so they go back on the wire exactly as received. */
function readCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || name === "__proto__" || name in cookies) continue;
    cookies[name] = part.slice(separator + 1).trim();
  }
  return cookies;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** What a response's `Set-Cookie` headers do to a cookie jar: set values and expired names. */
function readSetCookies(headers: Headers, now: number): Array<[string, string | null]> {
  const changes: Array<[string, string | null]> = [];
  for (const line of headers.getSetCookie()) {
    const [pair = "", ...attributes] = line.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    if (!name || name === "__proto__") continue;
    let expired = false;
    for (const attribute of attributes) {
      const [rawKey = "", ...rest] = attribute.split("=");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join("=").trim();
      if (key === "max-age" && /^-?\d+$/.test(value)) expired = Number(value) <= 0;
      if (key === "expires" && !attributes.some((item) => /^\s*max-age=/i.test(item))) {
        const time = Date.parse(value);
        if (!Number.isNaN(time) && time <= now) expired = true;
      }
    }
    changes.push([name, expired ? null : pair.slice(separator + 1).trim()]);
  }
  return changes;
}

function applySetCookies(
  jar: Record<string, string>,
  changes: Array<[string, string | null]>,
): Record<string, string> {
  const next = { ...jar };
  for (const [name, value] of changes) {
    if (name === FARM_MOBILE_DEVICE_COOKIE) continue;
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Responses

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const response = Response.json(body, { status, headers });
  response.headers.set("cache-control", "no-store");
  return response;
}

function failure(status: number, error: string, message: string): Response {
  const response = json({ error, message }, status);
  if (status === 401) {
    response.headers.set("www-authenticate", `Bearer error="invalid_token"`);
  }
  return response;
}

/** No `Origin`, no Fetch Metadata: a request no browser sends. */
export function isFarmMobileNativeRequest(request: Request): boolean {
  return !BROWSER_HEADERS.some((name) => request.headers.has(name));
}

function readAppId(request: Request): string | null {
  const value = request.headers.get(FARM_MOBILE_APP_HEADER)?.trim();
  return value && value.length <= 255 && APP_ID.test(value) ? value : null;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") return null;
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------------------------
// The plugin

class SessionReadError extends Error {
  constructor(
    message: string,
    readonly reason: unknown,
  ) {
    super(message);
  }
}

export function createFarmMobileSessionPlugin(options: FarmMobileSessionOptions): FarmPlugin {
  const basePath = options.basePath && options.basePath !== "/" ? options.basePath : "";
  const accessTtl = (options.accessTokenTtl ?? 15 * 60) * 1000;
  const refreshTtl = (options.refreshTokenTtl ?? 30 * 24 * 60 * 60) * 1000;
  const nonceTtl = (options.nonceTtl ?? 60) * 1000;
  const now = options.now ?? Date.now;
  const store = (): FarmMobileSessionStore =>
    options.storage?.() ?? (getStorage(STORAGE_NAMESPACE) as unknown as FarmMobileSessionStore);
  let warnedNoReader = false;

  function sessionReader(): SessionReader | null {
    for (const integration of Object.values(options.integrations() ?? {})) {
      const session = (integration as { session?: unknown } | undefined)?.session;
      if (typeof session === "function") {
        return (request) => (session as SessionReader).call(integration, request);
      }
    }
    return null;
  }

  /** The signed-in session for these cookies, null when signed out. Throws when it can't tell. */
  async function readSession(
    reader: SessionReader,
    url: string,
    cookies: Record<string, string>,
  ): Promise<FarmIntegrationSession | null> {
    const header = cookieHeader(cookies);
    if (!header) return null;
    let session: unknown;
    try {
      session = await reader(new Request(url, { headers: { cookie: header } }));
    } catch (error) {
      throw new SessionReadError("The auth integration's session() failed", error);
    }
    const id = (session as { id?: unknown } | null)?.id;
    return typeof id === "string" && id ? (session as FarmIntegrationSession) : null;
  }

  function noReader(): Response {
    if (!warnedNoReader) {
      warnedNoReader = true;
      console.warn(
        "[Farm] Mobile session tokens need an auth integration that reads sessions (`session()`): " +
          "@farm.js/auth (`auth: true`) or @farm.js/better-auth. No configured integration has one, " +
          "so native screens stay signed out.",
      );
    }
    return failure(
      501,
      "mobile_session_unavailable",
      "No auth integration in this app reads sessions for mobile tokens.",
    );
  }

  function markerCookie(request: Request, value: string, maxAge: number): string {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return `${FARM_MOBILE_DEVICE_COOKIE}=${value}; Path=${basePath || "/"}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  }

  async function loadDevice(deviceId: string): Promise<DeviceRecord | null> {
    const record = (await store().getItem(`device:${deviceId}`)) as DeviceRecord | null;
    return record && record.v === 1 ? record : null;
  }

  async function saveDevice(deviceId: string, record: DeviceRecord): Promise<void> {
    await store().setItem(`device:${deviceId}`, record);
  }

  async function revokeDevice(deviceId: string): Promise<void> {
    await store().removeItem(`device:${deviceId}`);
  }

  async function challengeKey(sessionId: string, appId: string): Promise<string> {
    return `challenge:${await sha256(`${sessionId}\n${appId}`)}`;
  }

  async function issueTokens(
    deviceId: string,
    key: string,
    base: Omit<
      DeviceRecord,
      "accessHash" | "accessExpiresAt" | "refreshHash" | "refreshExpiresAt" | "jar"
    >,
    jar: Record<string, string>,
  ): Promise<{ record: DeviceRecord; body: Record<string, unknown> }> {
    const access = { deviceId, secret: randomToken(32), key };
    const refresh = { deviceId, secret: randomToken(32), key };
    const issuedAt = now();
    const record: DeviceRecord = {
      ...base,
      accessHash: await sha256(access.secret),
      accessExpiresAt: issuedAt + accessTtl,
      refreshHash: await sha256(refresh.secret),
      refreshExpiresAt: issuedAt + refreshTtl,
      jar: await sealJar(jar, key, deviceId),
    };
    await saveDevice(deviceId, record);
    return {
      record,
      body: {
        tokenType: "Bearer",
        accessToken: formatToken(ACCESS_PREFIX, access),
        refreshToken: formatToken(REFRESH_PREFIX, refresh),
        expiresIn: Math.floor(accessTtl / 1000),
        refreshExpiresIn: Math.floor(refreshTtl / 1000),
      },
    };
  }

  /** Common checks for the four endpoints. */
  function guardEndpoint(request: Request): { appId: string } | Response {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST", "cache-control": "no-store" },
      });
    }
    if (!isFarmMobileNativeRequest(request)) {
      return failure(403, "not_native", "Mobile session endpoints answer the app's shell only.");
    }
    const appId = readAppId(request);
    if (!appId) {
      return failure(400, "invalid_app", `Send the app's mobile.id in ${FARM_MOBILE_APP_HEADER}.`);
    }
    return { appId };
  }

  async function challenge(request: Request): Promise<Response> {
    const guard = guardEndpoint(request);
    if (guard instanceof Response) return guard;
    const reader = sessionReader();
    if (!reader) return noReader();
    const cookies = readCookies(request.headers.get("cookie"));
    delete cookies[FARM_MOBILE_DEVICE_COOKIE];
    const session = await readSession(reader, request.url, cookies);
    if (!session) return failure(401, "signed_out", "Sign in on a web screen first.");
    const nonce = randomToken(32);
    // One outstanding nonce per session and app: a new challenge replaces the last one.
    await store().setItem(await challengeKey(session.id, guard.appId), {
      hash: await sha256(nonce),
      expiresAt: now() + nonceTtl,
    } satisfies ChallengeRecord);
    return json({ nonce, expiresIn: Math.floor(nonceTtl / 1000) });
  }

  async function issue(request: Request): Promise<Response> {
    const guard = guardEndpoint(request);
    if (guard instanceof Response) return guard;
    const reader = sessionReader();
    if (!reader) return noReader();
    const body = await readJsonBody(request);
    const nonce = typeof body?.nonce === "string" ? body.nonce : "";
    const cookies = readCookies(request.headers.get("cookie"));
    delete cookies[FARM_MOBILE_DEVICE_COOKIE];
    const session = await readSession(reader, request.url, cookies);
    if (!session) return failure(401, "signed_out", "Sign in on a web screen first.");

    const key = await challengeKey(session.id, guard.appId);
    const pending = (await store().getItem(key)) as ChallengeRecord | null;
    // Single use, whether it matches or not.
    if (pending) await store().removeItem(key);
    if (
      !pending ||
      pending.expiresAt <= now() ||
      !nonce ||
      !farmSecretsMatch(await sha256(nonce), pending.hash)
    ) {
      return failure(401, "invalid_nonce", "Request a new challenge and try again.");
    }

    const deviceId = randomToken(16);
    const { body: tokens } = await issueTokens(
      deviceId,
      randomToken(32),
      {
        v: 1,
        appId: guard.appId,
        sessionHash: await sha256(session.id),
        createdAt: now(),
        usedRefreshHashes: [],
      },
      cookies,
    );
    const response = json(tokens);
    response.headers.append(
      "set-cookie",
      markerCookie(request, deviceId, Math.floor(refreshTtl / 1000)),
    );
    return response;
  }

  async function refresh(request: Request): Promise<Response> {
    const guard = guardEndpoint(request);
    if (guard instanceof Response) return guard;
    const reader = sessionReader();
    if (!reader) return noReader();
    const body = await readJsonBody(request);
    const token = parseFarmMobileToken(
      typeof body?.refreshToken === "string" ? body.refreshToken : null,
      "refresh",
    );
    if (!token) return failure(401, "invalid_token", "Unknown refresh token.");
    const record = await loadDevice(token.deviceId);
    if (!record) return failure(401, "invalid_token", "Unknown refresh token.");
    if (record.appId !== guard.appId) {
      return failure(401, "invalid_token", "The token belongs to another app.");
    }

    const hash = await sha256(token.secret);
    if (!farmSecretsMatch(hash, record.refreshHash)) {
      if (record.usedRefreshHashes.some((used) => farmSecretsMatch(hash, used))) {
        // A rotated refresh token came back: someone kept a copy. End the device's session.
        await revokeDevice(token.deviceId);
        return failure(401, "refresh_reused", "The refresh token was already used.");
      }
      return failure(401, "invalid_token", "Unknown refresh token.");
    }
    if (record.refreshExpiresAt <= now()) {
      await revokeDevice(token.deviceId);
      return failure(401, "invalid_token", "The refresh token expired.");
    }

    const jar = await openJar(record.jar, token.key, token.deviceId);
    if (!jar) return failure(401, "invalid_token", "Unknown refresh token.");
    let session: FarmIntegrationSession | null;
    try {
      session = await readSession(reader, request.url, jar);
    } catch (error) {
      console.error("[Farm] Mobile session refresh could not read the session:", error);
      return failure(503, "session_unavailable", "Try again later.");
    }
    if (!session || (await sha256(session.id)) !== record.sessionHash) {
      await revokeDevice(token.deviceId);
      return failure(401, "signed_out", "The web session behind this device ended.");
    }

    const { body: tokens } = await issueTokens(
      token.deviceId,
      randomToken(32),
      {
        v: 1,
        appId: record.appId,
        sessionHash: record.sessionHash,
        createdAt: record.createdAt,
        usedRefreshHashes: [record.refreshHash, ...record.usedRefreshHashes].slice(
          0,
          USED_REFRESH_LIMIT,
        ),
      },
      jar,
    );
    const response = json(tokens);
    // Keep the WebView's device marker as long-lived as the refresh token it goes with.
    response.headers.append(
      "set-cookie",
      markerCookie(request, token.deviceId, Math.floor(refreshTtl / 1000)),
    );
    return response;
  }

  async function revoke(request: Request): Promise<Response> {
    const guard = guardEndpoint(request);
    if (guard instanceof Response) return guard;
    const body = await readJsonBody(request);
    const access = parseFarmMobileToken(bearer(request), "access");
    const refreshToken = parseFarmMobileToken(
      typeof body?.refreshToken === "string" ? body.refreshToken : null,
      "refresh",
    );
    const token = access ?? refreshToken;
    if (token) {
      const record = await loadDevice(token.deviceId);
      const hash = await sha256(token.secret);
      if (
        record &&
        record.appId === guard.appId &&
        farmSecretsMatch(hash, access ? record.accessHash : record.refreshHash)
      ) {
        await revokeDevice(token.deviceId);
      }
    }
    // Idempotent and silent: an unknown token is already as revoked as it gets.
    const response = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    response.headers.append("set-cookie", markerCookie(request, "", 0));
    return response;
  }

  /** Swaps a valid mobile bearer for the device's cookie session. */
  async function before(
    event: FarmPluginRuntimeBaseEvent,
  ): Promise<Request | Response | undefined> {
    const { request } = event;
    const value = bearer(request);
    if (!value?.startsWith(`${ACCESS_PREFIX}.`)) return undefined;
    // A browser page sending a bearer (forged or not) keeps today's cookie and origin checks.
    if (!isFarmMobileNativeRequest(request)) return undefined;
    const token = parseFarmMobileToken(value, "access");
    if (!token) return failure(401, "invalid_token", "Unknown access token.");
    const appId = readAppId(request);
    const record = await loadDevice(token.deviceId);
    const hash = await sha256(token.secret);
    if (!record || !farmSecretsMatch(hash, record.accessHash)) {
      return failure(401, "invalid_token", "Unknown access token.");
    }
    if (!appId || appId !== record.appId) {
      return failure(401, "invalid_token", "The token belongs to another app.");
    }
    if (record.accessExpiresAt <= now()) {
      return failure(401, "invalid_token", "The access token expired.");
    }
    const jar = await openJar(record.jar, token.key, token.deviceId);
    if (!jar) return failure(401, "invalid_token", "Unknown access token.");

    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.delete("cookie");
    const cookies = cookieHeader(jar);
    if (cookies) headers.set("cookie", cookies);
    // The token proves the request is first-party; it now looks like one to every origin check.
    headers.set("origin", new URL(request.url).origin);
    event.req.set(STATE_KEY, {
      deviceId: token.deviceId,
      key: token.key,
      accessHash: record.accessHash,
    } satisfies BearerState);
    return new Request(request, { headers });
  }

  async function after(
    event: FarmPluginRuntimeBaseEvent & { response: Response },
  ): Promise<Response | undefined> {
    const state = event.req.get<BearerState>(STATE_KEY);
    if (state) return afterBearer(event.request, event.response, state);
    const cookie = event.request.headers.get("cookie");
    if (!cookie?.includes(`${FARM_MOBILE_DEVICE_COOKIE}=`)) return undefined;
    return afterWebScreen(event.request, event.response);
  }

  /**
   * A bearer response: keep cookie rotations in the device's jar instead of sending them to the
   * native client, and never let a shared cache store it.
   */
  async function afterBearer(
    request: Request,
    response: Response,
    state: BearerState,
  ): Promise<Response> {
    const changes = readSetCookies(response.headers, now());
    const headers = new Headers(response.headers);
    headers.delete("set-cookie");
    headers.set("cache-control", "private, no-store");
    if (changes.length > 0) {
      const record = await loadDevice(state.deviceId);
      // A refresh in between rotated the tokens; that request already saved the jar.
      if (record && farmSecretsMatch(state.accessHash, record.accessHash)) {
        const jar = await openJar(record.jar, state.key, state.deviceId);
        if (jar) {
          const next = applySetCookies(jar, changes);
          const reader = sessionReader();
          let signedOut = false;
          if (reader && changes.some(([, value]) => value === null)) {
            signedOut = await readSession(reader, request.url, next).then(
              async (session) => !session || (await sha256(session.id)) !== record.sessionHash,
              () => false,
            );
          }
          if (signedOut) await revokeDevice(state.deviceId);
          else
            await saveDevice(state.deviceId, {
              ...record,
              jar: await sealJar(next, state.key, state.deviceId),
            });
        }
      }
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /**
   * A response to the shell's WebView that clears cookies: if the cookies left sign nobody in,
   * the user signed out on the web, so the device token goes too.
   */
  async function afterWebScreen(
    request: Request,
    response: Response,
  ): Promise<Response | undefined> {
    const changes = readSetCookies(response.headers, now());
    if (!changes.some(([, value]) => value === null)) return undefined;
    const cookies = readCookies(request.headers.get("cookie"));
    const deviceId = cookies[FARM_MOBILE_DEVICE_COOKIE];
    if (!deviceId || deviceId.length !== 22 || !BASE64URL.test(deviceId)) return undefined;
    const reader = sessionReader();
    if (!reader) return undefined;
    delete cookies[FARM_MOBILE_DEVICE_COOKIE];
    const signedOut = await readSession(
      reader,
      request.url,
      applySetCookies(cookies, changes),
    ).then(
      (session) => !session,
      () => false,
    );
    if (!signedOut) return undefined;
    await revokeDevice(deviceId);
    const headers = new Headers(response.headers);
    headers.append("set-cookie", markerCookie(request, "", 0));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const endpoint = (path: string, handler: (request: Request) => Promise<Response>) => ({
    path,
    handler: (event: { request: Request }) =>
      handler(event.request).catch((error: unknown) => {
        if (error instanceof SessionReadError) {
          console.error("[Farm] Mobile session endpoint could not read the session:", error.reason);
          return failure(503, "session_unavailable", "Try again later.");
        }
        throw error;
      }),
  });

  return {
    name: FARM_MOBILE_SESSION_PLUGIN,
    // Before app plugins, so their hooks see the signed-in request.
    enforce: "pre",
    runtime: {
      // `before` changes only requests with a mobile bearer, and `after` marks those private.
      // Every other response stays as cacheable as it was.
      cache: "public",
      endpoints: [
        endpoint(`${FARM_MOBILE_SESSION_PATH}/challenge`, challenge),
        endpoint(FARM_MOBILE_SESSION_PATH, issue),
        endpoint(`${FARM_MOBILE_SESSION_PATH}/refresh`, refresh),
        endpoint(`${FARM_MOBILE_SESSION_PATH}/revoke`, revoke),
      ],
      before: before as never,
      after: after as never,
    },
  };
}
