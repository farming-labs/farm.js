import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { defineIntegration, integrationRoute, type FarmIntegrationLogger } from "@farmjs/core";
import {
  clearRequestCookie,
  createPathInferredClientApi,
  createDocumentNavigationMatchers,
  createRequestCookie,
  getOrigin,
  getReturnTo,
  normalizeMatchers,
  parseCookieHeaderMap,
  resolveCallbackSettings,
} from "../utils/index.js";
import type { Auth0ProfileResult, Auth0RedirectQuery, Auth0RedirectResult } from "./client.js";
import { auth0Client } from "./client.js";

const DEV_SECRET = "farmjs-auth0-development-secret-2026";

export interface Auth0Instance {
  middleware(request: Request): Promise<Response | void> | Response | void;
  matcher?: string | string[];
}

export interface Auth0IntegrationInput {
  instance?: Auth0Instance;
  domain?: string;
  clientId?: string;
  clientSecret?: string;
  secret?: string;
  appBaseUrl?: string;
  callbackUrl?: string;
  loginPath?: string;
  signUpPath?: string;
  callbackPath?: string;
  logoutPath?: string;
  profilePath?: string;
  protectedRoutes?: string | string[];
  audience?: string;
  scopes?: string[];
  tokenEndpointAuthMethod?: "auto" | "client_secret_basic" | "client_secret_post" | "none";
  log?: FarmIntegrationLogger;
}

interface ResolvedAuth0Env {
  domain: string;
  clientId: string;
  clientSecret?: string;
  secret: string;
  appBaseUrl?: string;
}

interface Auth0StatePayload {
  state: string;
  returnTo: string;
  codeVerifier: string;
}

interface Auth0SessionPayload {
  user: Record<string, unknown>;
  expiresAt: number;
}

interface Auth0RedirectResponse extends Auth0RedirectResult {
  headers: Headers;
}

function createAuth0Api(input: {
  loginPath: string;
  signUpPath: string;
  logoutPath: string;
  profilePath: string;
}) {
  return createPathInferredClientApi(
    {
      path: input.loginPath,
      operation: auth0Client.login,
    },
    {
      path: input.signUpPath,
      operation: auth0Client.signup,
    },
    {
      path: input.logoutPath,
      operation: auth0Client.logout,
    },
    {
      path: input.profilePath,
      operation: auth0Client.profile,
    },
  );
}

function normalizeDomain(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function resolveEnv(input: Auth0IntegrationInput): ResolvedAuth0Env {
  const domain = normalizeDomain(input.domain ?? process.env.AUTH0_DOMAIN ?? "");
  const clientId = input.clientId ?? process.env.AUTH0_CLIENT_ID ?? "";
  const clientSecret = input.clientSecret ?? process.env.AUTH0_CLIENT_SECRET ?? "";
  const secret =
    input.secret ??
    process.env.AUTH0_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : DEV_SECRET);
  const appBaseUrl = input.appBaseUrl ?? process.env.APP_BASE_URL ?? undefined;

  if (!domain || !clientId) {
    throw new Error("Auth0 integration requires AUTH0_DOMAIN and AUTH0_CLIENT_ID.");
  }

  if (!secret) {
    throw new Error("Auth0 integration requires AUTH0_SECRET in production.");
  }

  return {
    domain,
    clientId,
    clientSecret: clientSecret || undefined,
    secret,
    appBaseUrl,
  };
}

function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function signValue(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function unsignValue<T>(signed: string | undefined, secret: string): T | null {
  if (!signed) {
    return null;
  }

  const separator = signed.lastIndexOf(".");
  if (separator === -1) {
    return null;
  }

  const payload = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  if (signature.length !== expected.length) {
    return null;
  }

  if (!timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function getSession(
  request: Request,
  cookieName: string,
  secret: string,
): Auth0SessionPayload | null {
  const cookies = parseCookieHeaderMap(request.headers.get("cookie"));
  const session = unsignValue<Auth0SessionPayload>(cookies[cookieName], secret);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    return null;
  }

  return session;
}

async function createUserProfile(
  domain: string,
  accessToken: string | undefined,
  idToken: string | undefined,
): Promise<Record<string, unknown>> {
  if (accessToken) {
    const response = await fetch(`https://${domain}/userinfo`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      return (await response.json()) as Record<string, unknown>;
    }
  }

  return decodeJwtPayload(idToken) || {};
}

async function exchangeCode(
  domain: string,
  clientId: string,
  clientSecret: string | undefined,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  tokenEndpointAuthMethod: Auth0IntegrationInput["tokenEndpointAuthMethod"] = "auto",
) {
  const methods =
    tokenEndpointAuthMethod && tokenEndpointAuthMethod !== "auto"
      ? [tokenEndpointAuthMethod]
      : clientSecret
        ? (["client_secret_basic", "client_secret_post", "none"] as const)
        : (["none"] as const);

  let lastFailure = "Auth0 token exchange failed.";

  for (const method of methods) {
    if ((method === "client_secret_basic" || method === "client_secret_post") && !clientSecret) {
      continue;
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    const headers = new Headers({
      "content-type": "application/x-www-form-urlencoded",
    });

    if (method === "client_secret_post") {
      body.set("client_secret", clientSecret!);
    }

    if (method === "client_secret_basic") {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${clientId}:${clientSecret!}`, "utf8").toString("base64")}`,
      );
      body.delete("client_id");
    }

    const response = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers,
      body,
    });

    if (response.ok) {
      return (await response.json()) as {
        access_token?: string;
        id_token?: string;
        expires_in?: number;
      };
    }

    const message = await response.text();
    lastFailure = message || "Auth0 token exchange failed.";

    // Retry only when Auth0 is rejecting the client authentication method.
    if (response.status === 401 || response.status === 403) {
      continue;
    }

    throw new Error(lastFailure);
  }

  throw new Error(lastFailure);
}

export function auth0(input: Auth0IntegrationInput = {}) {
  if (input.instance) {
    return defineIntegration({
      category: "auth",
      type: "auth0",
      instance: input.instance,
      log: input.log,
      middleware: [
        {
          matcher: input.instance.matcher || ["/auth(.*)"],
          handler(request: Request) {
            return input.instance!.middleware(request);
          },
        },
      ],
    });
  }

  const { domain, clientId, clientSecret, secret, appBaseUrl } = resolveEnv(input);
  const protectedMatchers = normalizeMatchers(input.protectedRoutes);
  const loginPath = input.loginPath ?? "/auth/login";
  const signUpPath = input.signUpPath ?? "/auth/signup";
  const logoutPath = input.logoutPath ?? "/auth/logout";
  const profilePath = input.profilePath ?? "/auth/profile";
  const scopes = input.scopes?.length ? input.scopes : ["openid", "profile", "email"];
  const stateCookieName = "farm_auth0_state";
  const sessionCookieName = "farm_auth0_session";
  const callbackSettings = resolveCallbackSettings(
    {
      callbackUrl: input.callbackUrl,
      callbackPath: input.callbackPath,
      defaultPath: "/auth/callback",
      label: "Auth0 integration",
    },
    appBaseUrl,
  );
  const callbackPath = callbackSettings.callbackPath;

  async function redirectToAuth(
    request: Request,
    screenHint?: "signup",
  ): Promise<Auth0RedirectResponse> {
    const requestUrl = new URL(request.url);
    const callbackUrl = callbackSettings.getCallbackUrl(request);
    const returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/dashboard");
    const state = randomBytes(16).toString("hex");
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    const authorizeUrl = new URL("/authorize", `https://${domain}`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("scope", scopes.join(" "));
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    if (input.audience) {
      authorizeUrl.searchParams.set("audience", input.audience);
    }

    if (screenHint) {
      authorizeUrl.searchParams.set("screen_hint", screenHint);
    }

    const headers = new Headers();
    headers.append(
      "set-cookie",
      createRequestCookie(
        stateCookieName,
        signValue({ state, returnTo, codeVerifier } satisfies Auth0StatePayload, secret),
        request,
        { maxAge: 600 },
      ),
    );
    return {
      redirectTo: authorizeUrl.toString(),
      headers,
    };
  }

  return defineIntegration({
    category: "auth",
    type: "auth0",
    instance: {
      domain,
      clientId,
      protectedRoutes: protectedMatchers,
    },
    api: createAuth0Api({
      loginPath,
      signUpPath,
      logoutPath,
      profilePath,
    }),
    log: input.log,
    documentNavigations: [
      {
        matcher: createDocumentNavigationMatchers(loginPath, signUpPath, callbackPath, logoutPath),
      },
    ],
    routes: [
      integrationRoute.get<typeof loginPath, Auth0RedirectResult, Auth0RedirectQuery>(loginPath, {
        responseFormat: "json",
        async handler(request: Request) {
          const result = await redirectToAuth(request);
          const headers = result.headers;
          const redirectTo = result.redirectTo;

          if (request.headers.get("x-farm-integration-client") === "1") {
            return Response.json({ redirectTo }, { status: 200, headers });
          }

          headers.set("location", redirectTo);
          return new Response(null, {
            status: 302,
            headers,
          });
        },
      }),
      integrationRoute.get<typeof signUpPath, Auth0RedirectResult, Auth0RedirectQuery>(signUpPath, {
        responseFormat: "json",
        async handler(request: Request) {
          const result = await redirectToAuth(request, "signup");
          const headers = result.headers;
          const redirectTo = result.redirectTo;

          if (request.headers.get("x-farm-integration-client") === "1") {
            return Response.json({ redirectTo }, { status: 200, headers });
          }

          headers.set("location", redirectTo);
          return new Response(null, {
            status: 302,
            headers,
          });
        },
      }),
      integrationRoute.get(callbackPath, {
        handler(request: Request) {
          return (async () => {
            const requestUrl = new URL(request.url);
            const error = requestUrl.searchParams.get("error");
            const errorDescription = requestUrl.searchParams.get("error_description");

            if (error) {
              return new Response(errorDescription || error, { status: 400 });
            }

            const code = requestUrl.searchParams.get("code");
            const state = requestUrl.searchParams.get("state");
            if (!code || !state) {
              return new Response("Missing Auth0 authorization code or state.", { status: 400 });
            }

            const cookies = parseCookieHeaderMap(request.headers.get("cookie"));
            const statePayload = unsignValue<Auth0StatePayload>(cookies[stateCookieName], secret);
            if (!statePayload || statePayload.state !== state) {
              return new Response("Invalid Auth0 state.", { status: 400 });
            }

            const origin = getOrigin(request, appBaseUrl);
            const redirectUri = callbackSettings.getCallbackUrl(request);
            const tokenResponse = await exchangeCode(
              domain,
              clientId,
              clientSecret,
              code,
              redirectUri,
              statePayload.codeVerifier,
              input.tokenEndpointAuthMethod,
            );
            const user = await createUserProfile(
              domain,
              tokenResponse.access_token,
              tokenResponse.id_token,
            );
            const expiresAt = Date.now() + Math.max(tokenResponse.expires_in || 3600, 60) * 1000;

            const headers = new Headers();
            headers.append(
              "set-cookie",
              createRequestCookie(
                sessionCookieName,
                signValue({ user, expiresAt } satisfies Auth0SessionPayload, secret),
                request,
                {
                  maxAge: Math.max((expiresAt - Date.now()) / 1000, 60),
                },
              ),
            );
            headers.append("set-cookie", clearRequestCookie(stateCookieName, request));
            headers.set(
              "location",
              new URL(statePayload.returnTo || "/dashboard", origin).toString(),
            );

            return new Response(null, {
              status: 302,
              headers,
            });
          })();
        },
      }),
      integrationRoute.get<typeof logoutPath, Auth0RedirectResult>(logoutPath, {
        responseFormat: "json",
        handler(request: Request) {
          const origin = getOrigin(request, appBaseUrl);
          const redirectTo = new URL("/v2/logout", `https://${domain}`);
          redirectTo.searchParams.set("client_id", clientId);
          redirectTo.searchParams.set("returnTo", origin);

          const headers = new Headers();
          headers.append("set-cookie", clearRequestCookie(sessionCookieName, request));

          if (request.headers.get("x-farm-integration-client") === "1") {
            return Response.json(
              {
                redirectTo: redirectTo.toString(),
              },
              {
                status: 200,
                headers,
              },
            );
          }

          headers.set("location", redirectTo.toString());
          return new Response(null, {
            status: 302,
            headers,
          });
        },
      }),
      integrationRoute.get<typeof profilePath, Auth0ProfileResult>(profilePath, {
        responseFormat: "json",
        handler(request: Request) {
          const session = getSession(request, sessionCookieName, secret);

          if (!session) {
            return Response.json(
              {
                authenticated: false,
              },
              { status: 401 },
            );
          }

          return Response.json({
            authenticated: true,
            user: session.user,
          });
        },
      }),
    ],
    middleware:
      protectedMatchers.length > 0
        ? [
            {
              matcher: protectedMatchers,
              handler(request: Request) {
                const session = getSession(request, sessionCookieName, secret);
                if (session) {
                  return;
                }

                const requestUrl = new URL(request.url);
                const redirectUrl = new URL(loginPath, getOrigin(request, appBaseUrl));
                redirectUrl.searchParams.set(
                  "returnTo",
                  `${requestUrl.pathname}${requestUrl.search}`,
                );

                return Response.redirect(redirectUrl, 307);
              },
            },
          ]
        : [],
  });
}
