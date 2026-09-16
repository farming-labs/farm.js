import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import { defineIntegration, integrationRoute, type FarmIntegrationLogger } from "@farm.js/core";
import {
  describeIntegrationOriginRejection,
  resolveIntegrationAllowedOrigins,
  validateIntegrationRequestOrigin,
} from "@farm.js/core/integrations";
import {
  clearRequestCookie,
  createPathInferredClientApi,
  createDocumentNavigationMatchers,
  createRequestCookie,
  getCookieValue,
  getReturnTo,
  integrationConfig,
  normalizeMatchers,
} from "@farm.js/integration-utils";
import type { WorkOSRedirectQuery, WorkOSRedirectResult, WorkOSSessionResult } from "./client.js";
import { workosClient } from "./client.js";

export interface WorkOSIntegrationInput {
  /** Existing WorkOS SDK instance. When provided, Farm does not construct its own client. */
  instance?: WorkOSIntegrationInstance;
  clientId?: string;
  apiKey?: string;
  cookiePassword?: string;
  cookieName?: string;
  loginPath?: string;
  signUpPath?: string;
  callbackPath?: string;
  logoutPath?: string;
  sessionPath?: string;
  protectedRoutes?: string | string[];
  /**
   * Additional origins allowed to post the sign-out route, using the same
   * pattern syntax as `serverActions.allowedOrigins`. The app's own origin is
   * always trusted.
   */
  allowedOrigins?: string[];
  log?: FarmIntegrationLogger;
}

export type WorkOSIntegrationInstance = WorkOS;

const DEV_COOKIE_PASSWORD = "farmjs-workos-cookie-password-development-2026";

// The built server re-evaluates farm.config.ts at runtime to instantiate
// integrations, and Farm does not force NODE_ENV=production into that process.
// Treating an absent NODE_ENV as "development" would silently seal production
// sessions with the public DEV_COOKIE_PASSWORD, so only an explicit dev/test
// value may use it. `farm dev` runs through Vite, which sets
// NODE_ENV="development".
function isExplicitDevelopmentEnv(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

interface ResolvedWorkOSConfig {
  clientId: string;
  apiKey?: string;
  cookiePassword: string;
}

interface WorkOSStatePayload {
  state: string;
  returnTo: string;
}

interface WorkOSRedirectResponse extends WorkOSRedirectResult {
  headers: Headers;
}

// The OAuth `state` must be unguessable and bound to the browser that started
// the flow, so it is signed with the session cookie password and stored in a
// short-lived cookie. Mirrors the signing helpers in @farm.js/auth0.
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

function createWorkOSApi(input: {
  loginPath: string;
  signUpPath: string;
  logoutPath: string;
  sessionPath: string;
}) {
  return createPathInferredClientApi(
    {
      path: input.loginPath,
      operation: workosClient.login,
    },
    {
      path: input.signUpPath,
      operation: workosClient.signup,
    },
    {
      path: input.logoutPath,
      operation: workosClient.logout,
    },
    {
      path: input.sessionPath,
      operation: workosClient.session,
    },
  );
}

function resolveEnv(input: WorkOSIntegrationInput): ResolvedWorkOSConfig {
  const clientId = input.instance?.clientId ?? input.clientId ?? process.env.WORKOS_CLIENT_ID ?? "";
  const apiKey = input.apiKey ?? process.env.WORKOS_API_KEY ?? "";
  const cookiePassword =
    input.cookiePassword ??
    process.env.WORKOS_COOKIE_PASSWORD ??
    process.env.FARM_WORKOS_COOKIE_PASSWORD ??
    (isExplicitDevelopmentEnv() ? DEV_COOKIE_PASSWORD : "");

  if (!clientId || (!input.instance && !apiKey)) {
    throw new Error(
      "WorkOS integration requires a client ID and either a WorkOS instance or WORKOS_API_KEY.",
    );
  }

  if (!cookiePassword) {
    throw new Error(
      "WorkOS integration requires WORKOS_COOKIE_PASSWORD. A development-only fallback is used " +
        'only when NODE_ENV is "development" or "test"; set WORKOS_COOKIE_PASSWORD to a random ' +
        "32-byte value in every other environment.",
    );
  }

  return {
    clientId,
    apiKey: apiKey || undefined,
    cookiePassword,
  };
}

async function getSession(
  workos: WorkOSIntegrationInstance,
  request: Request,
  cookieName: string,
  cookiePassword: string,
) {
  const sessionData = getCookieValue(request.headers, cookieName);
  if (!sessionData) {
    return null;
  }

  const session = workos.userManagement.loadSealedSession({
    sessionData,
    cookiePassword,
  });
  const authentication = await session.authenticate();

  if (!authentication.authenticated) {
    return null;
  }

  return {
    session,
    authentication,
  };
}

export function workos(input: WorkOSIntegrationInput = {}) {
  const { clientId, apiKey, cookiePassword } = resolveEnv(input);
  const protectedMatchers = normalizeMatchers(input.protectedRoutes);
  const cookieName = input.cookieName ?? "wos-session";
  const loginPath = input.loginPath ?? "/login";
  const signUpPath = input.signUpPath ?? "/signup";
  const callbackPath = input.callbackPath ?? "/callback";
  const logoutPath = input.logoutPath ?? "/logout";
  const sessionPath = input.sessionPath ?? "/auth/session";
  const stateCookieName = `${cookieName}-state`;

  const allowedOrigins = resolveIntegrationAllowedOrigins(
    input.allowedOrigins,
    "workos.allowedOrigins",
  );

  const workos =
    input.instance ??
    new WorkOS({
      apiKey,
      clientId,
    });

  /**
   * Reject a sign-out request that did not come from this app. Returns the
   * response to send, or null when the request may proceed.
   */
  function rejectForeignOrigin(request: Request): Response | null {
    const result = validateIntegrationRequestOrigin(request, {
      allowedOrigins,
      requireOriginMetadata: request.method === "POST",
    });

    if (result.ok) {
      return null;
    }

    const message = describeIntegrationOriginRejection(result.reason);

    if (request.headers.get("x-farm-integration-client") === "1") {
      return Response.json({ error: message }, { status: 403 });
    }

    return new Response(message, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  async function redirectToAuth(
    request: Request,
    screenHint: "sign-in" | "sign-up",
  ): Promise<WorkOSRedirectResponse> {
    const requestUrl = new URL(request.url);
    const returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/dashboard");
    const callbackUrl = new URL(callbackPath, requestUrl.origin);
    // A random, single-use value. The callback accepts a code only when the
    // browser presents the matching signed cookie, so a code obtained by
    // someone else cannot be replayed into this browser's session.
    const state = randomBytes(32).toString("base64url");
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      provider: "authkit",
      clientId,
      redirectUri: callbackUrl.toString(),
      screenHint,
      state,
    });

    const headers = new Headers();
    headers.append(
      "set-cookie",
      createRequestCookie(
        stateCookieName,
        signValue({ state, returnTo } satisfies WorkOSStatePayload, cookiePassword),
        request,
        { maxAge: 600 },
      ),
    );

    return {
      redirectTo: authorizationUrl,
      headers,
    };
  }

  return defineIntegration({
    category: "auth",
    type: "workos",
    instance: {
      clientId,
      apiKey: "[redacted]",
      protectedRoutes: protectedMatchers,
    },
    config: integrationConfig<ResolvedWorkOSConfig>({
      label: "WorkOS integration",
      env: {
        clientId: "WORKOS_CLIENT_ID",
        apiKey: "WORKOS_API_KEY",
        cookiePassword: ["WORKOS_COOKIE_PASSWORD", "FARM_WORKOS_COOKIE_PASSWORD"],
      },
      input: {
        clientId,
        apiKey,
        cookiePassword,
      },
      required: input.instance
        ? ["clientId", "cookiePassword"]
        : ["clientId", "apiKey", "cookiePassword"],
    }),
    api: createWorkOSApi({
      loginPath,
      signUpPath,
      logoutPath,
      sessionPath,
    }),
    log: input.log,
    documentNavigations: [
      {
        matcher: createDocumentNavigationMatchers(loginPath, signUpPath, callbackPath),
      },
    ],
    routes: [
      integrationRoute.get<typeof loginPath, WorkOSRedirectResult, WorkOSRedirectQuery>(loginPath, {
        responseFormat: "json",
        async handler(request: Request) {
          const result = await redirectToAuth(request, "sign-in");

          if (request.headers.get("x-farm-integration-client") === "1") {
            return Response.json({ redirectTo: result.redirectTo }, { headers: result.headers });
          }

          result.headers.set("location", result.redirectTo);
          return new Response(null, { status: 302, headers: result.headers });
        },
      }),
      integrationRoute.get<typeof signUpPath, WorkOSRedirectResult, WorkOSRedirectQuery>(
        signUpPath,
        {
          responseFormat: "json",
          async handler(request: Request) {
            const result = await redirectToAuth(request, "sign-up");

            if (request.headers.get("x-farm-integration-client") === "1") {
              return Response.json({ redirectTo: result.redirectTo }, { headers: result.headers });
            }

            result.headers.set("location", result.redirectTo);
            return new Response(null, { status: 302, headers: result.headers });
          },
        },
      ),
      integrationRoute.get(callbackPath, {
        async handler(request: Request) {
          const requestUrl = new URL(request.url);
          const code = requestUrl.searchParams.get("code");
          const error = requestUrl.searchParams.get("error");
          const errorDescription = requestUrl.searchParams.get("error_description");

          if (error) {
            return new Response(errorDescription || error, { status: 400 });
          }

          if (!code) {
            return new Response("Missing WorkOS authorization code.", { status: 400 });
          }

          // Bind the code to the browser that started the flow. Without this a
          // code obtained elsewhere could be replayed into a victim's session.
          const state = requestUrl.searchParams.get("state");
          const statePayload = unsignValue<WorkOSStatePayload>(
            getCookieValue(request.headers, stateCookieName) ?? undefined,
            cookiePassword,
          );

          if (!state || !statePayload || statePayload.state !== state) {
            return new Response("Invalid WorkOS state.", { status: 400 });
          }

          const authentication = await workos.userManagement.authenticateWithCode({
            clientId,
            code,
            session: {
              sealSession: true,
              cookiePassword,
            },
          });

          if (!authentication.sealedSession) {
            return new Response("WorkOS did not return a sealed session.", { status: 500 });
          }

          const returnTo = getReturnTo(statePayload.returnTo, "/dashboard");

          const headers = new Headers();
          headers.append(
            "set-cookie",
            createRequestCookie(cookieName, authentication.sealedSession, request),
          );
          headers.append("set-cookie", clearRequestCookie(stateCookieName, request));
          headers.set("location", new URL(returnTo, requestUrl.origin).toString());

          return new Response(null, {
            status: 302,
            headers,
          });
        },
      }),
      integrationRoute.post<typeof logoutPath, { returnTo?: string }, WorkOSRedirectResult>(
        logoutPath,
        {
          responseFormat: "json",
          async handler(request: Request) {
            const rejected = rejectForeignOrigin(request);
            if (rejected) {
              return rejected;
            }

            const requestUrl = new URL(request.url);
            const sessionState = await getSession(workos, request, cookieName, cookiePassword);
            const headers = new Headers();
            headers.set("set-cookie", clearRequestCookie(cookieName, request));

            if (!sessionState) {
              const redirectTo = new URL("/", requestUrl.origin).toString();
              if (request.headers.get("x-farm-integration-client") === "1") {
                return Response.json({ redirectTo }, { status: 200, headers });
              }

              headers.set("location", redirectTo);
              return new Response(null, { status: 303, headers });
            }

            const logoutUrl = await sessionState.session.getLogoutUrl({
              returnTo: requestUrl.origin,
            });

            if (request.headers.get("x-farm-integration-client") === "1") {
              return Response.json({ redirectTo: logoutUrl }, { status: 200, headers });
            }

            headers.set("location", logoutUrl);
            return new Response(null, { status: 303, headers });
          },
        },
      ),
      integrationRoute.get<typeof sessionPath, WorkOSSessionResult>(sessionPath, {
        responseFormat: "json",
        async handler(request: Request) {
          const sessionState = await getSession(workos, request, cookieName, cookiePassword);

          if (!sessionState) {
            return Response.json(
              {
                authenticated: false,
              },
              { status: 401 },
            );
          }

          const { authentication } = sessionState;
          return Response.json({
            authenticated: true,
            sessionId: authentication.sessionId,
            organizationId: authentication.organizationId,
            user: {
              id: authentication.user.id,
              email: authentication.user.email,
              firstName: authentication.user.firstName,
              lastName: authentication.user.lastName,
              profilePictureUrl: authentication.user.profilePictureUrl,
            },
          });
        },
      }),
    ],
    middleware:
      protectedMatchers.length > 0
        ? [
            {
              matcher: protectedMatchers,
              async handler(request: Request) {
                const sessionState = await getSession(workos, request, cookieName, cookiePassword);
                if (sessionState) {
                  return;
                }

                const requestUrl = new URL(request.url);
                const loginUrl = new URL(loginPath, request.url);
                loginUrl.searchParams.set("returnTo", `${requestUrl.pathname}${requestUrl.search}`);
                return Response.redirect(loginUrl, 307);
              },
            },
          ]
        : [],
  });
}
