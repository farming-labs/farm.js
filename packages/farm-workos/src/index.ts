import { WorkOS } from "@workos-inc/node";
import { defineIntegration, integrationRoute, type FarmIntegrationLogger } from "@farm.js/core";
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
  log?: FarmIntegrationLogger;
}

export type WorkOSIntegrationInstance = WorkOS;

const DEV_COOKIE_PASSWORD = "farmjs-workos-cookie-password-development-2026";

interface ResolvedWorkOSConfig {
  clientId: string;
  apiKey?: string;
  cookiePassword: string;
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
    (process.env.NODE_ENV === "production" ? "" : DEV_COOKIE_PASSWORD);

  if (!clientId || (!input.instance && !apiKey)) {
    throw new Error(
      "WorkOS integration requires a client ID and either a WorkOS instance or WORKOS_API_KEY.",
    );
  }

  if (!cookiePassword) {
    throw new Error("WorkOS integration requires WORKOS_COOKIE_PASSWORD in production.");
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

  const workos =
    input.instance ??
    new WorkOS({
      apiKey,
      clientId,
    });

  async function redirectToAuth(request: Request, screenHint: "sign-in" | "sign-up") {
    const requestUrl = new URL(request.url);
    const returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/dashboard");
    const callbackUrl = new URL(callbackPath, requestUrl.origin);
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      provider: "authkit",
      clientId,
      redirectUri: callbackUrl.toString(),
      screenHint,
      state: JSON.stringify({ returnTo }),
    });

    return {
      redirectTo: authorizationUrl,
    } satisfies WorkOSRedirectResult;
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
            return Response.json(result);
          }

          return Response.redirect(result.redirectTo, 302);
        },
      }),
      integrationRoute.get<typeof signUpPath, WorkOSRedirectResult, WorkOSRedirectQuery>(
        signUpPath,
        {
          responseFormat: "json",
          async handler(request: Request) {
            const result = await redirectToAuth(request, "sign-up");

            if (request.headers.get("x-farm-integration-client") === "1") {
              return Response.json(result);
            }

            return Response.redirect(result.redirectTo, 302);
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

          let returnTo = "/dashboard";
          const rawState = requestUrl.searchParams.get("state");
          if (rawState) {
            try {
              const parsed = JSON.parse(rawState) as { returnTo?: string };
              returnTo = getReturnTo(parsed.returnTo ?? null, "/dashboard");
            } catch {
              returnTo = "/dashboard";
            }
          }

          const headers = new Headers();
          headers.set(
            "set-cookie",
            createRequestCookie(cookieName, authentication.sealedSession, request),
          );
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
