import { WorkOS } from "@workos-inc/node";
import { defineIntegration, type FarmIntegrationLogger } from "@farmjs/core";
import {
  clearRequestCookie,
  createDocumentNavigationMatchers,
  createRequestCookie,
  getCookieValue,
  getReturnTo,
  normalizeMatchers,
} from "../utils/index.js";

export interface WorkOSIntegrationInput {
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

const DEV_COOKIE_PASSWORD = "farmjs-workos-cookie-password-development-2026";

function resolveEnv(input: WorkOSIntegrationInput) {
  const clientId = input.clientId ?? process.env.WORKOS_CLIENT_ID ?? "";
  const apiKey = input.apiKey ?? process.env.WORKOS_API_KEY ?? "";
  const cookiePassword =
    input.cookiePassword ??
    process.env.WORKOS_COOKIE_PASSWORD ??
    process.env.FARM_WORKOS_COOKIE_PASSWORD ??
    (process.env.NODE_ENV === "production" ? "" : DEV_COOKIE_PASSWORD);

  if (!clientId || !apiKey) {
    throw new Error("WorkOS integration requires WORKOS_CLIENT_ID and WORKOS_API_KEY.");
  }

  if (!cookiePassword) {
    throw new Error(
      "WorkOS integration requires WORKOS_COOKIE_PASSWORD in production.",
    );
  }

  return {
    clientId,
    apiKey,
    cookiePassword,
  };
}

async function getSession(
  workos: WorkOS,
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

  const workos = new WorkOS({
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

    return Response.redirect(authorizationUrl, 302);
  }

  return defineIntegration({
    category: "auth",
    type: "workos",
    instance: {
      clientId,
      apiKey: "[redacted]",
      protectedRoutes: protectedMatchers,
    },
    log: input.log,
    documentNavigations: [
      {
        matcher: createDocumentNavigationMatchers(loginPath, signUpPath, callbackPath),
      },
    ],
    routes: [
      {
        path: loginPath,
        methods: ["GET"],
        handler(request: Request) {
          return redirectToAuth(request, "sign-in");
        },
      },
      {
        path: signUpPath,
        methods: ["GET"],
        handler(request: Request) {
          return redirectToAuth(request, "sign-up");
        },
      },
      {
        path: callbackPath,
        methods: ["GET"],
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
      },
      {
        path: logoutPath,
        methods: ["POST"],
        async handler(request: Request) {
          const requestUrl = new URL(request.url);
          const sessionState = await getSession(workos, request, cookieName, cookiePassword);
          const headers = new Headers();
          headers.set("set-cookie", clearRequestCookie(cookieName, request));

          if (!sessionState) {
            headers.set("location", new URL("/", requestUrl.origin).toString());
            return new Response(null, {
              status: 303,
              headers,
            });
          }

          const logoutUrl = await sessionState.session.getLogoutUrl({
            returnTo: requestUrl.origin,
          });
          headers.set("location", logoutUrl);

          return new Response(null, {
            status: 303,
            headers,
          });
        },
      },
      {
        path: sessionPath,
        methods: ["GET"],
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
      },
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
                loginUrl.searchParams.set(
                  "returnTo",
                  `${requestUrl.pathname}${requestUrl.search}`,
                );
                return Response.redirect(loginUrl, 307);
              },
            },
          ]
        : [],
  });
}
