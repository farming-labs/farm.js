import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { defineIntegration, type FarmIntegrationLogger } from "@farm.js/core";
import {
  createDocumentNavigationMatchers,
  integrationConfig,
  normalizeMatchers,
} from "../utils/index.js";

export interface ClerkIntegrationInput {
  publishableKey?: string;
  secretKey?: string;
  signInUrl?: string;
  signUpUrl?: string;
  protectedRoutes?: string | string[];
  authorizedParties?: string[];
  providerProps?: Record<string, unknown>;
  log?: FarmIntegrationLogger;
}

interface ResolvedClerkConfig {
  publishableKey: string;
  secretKey: string;
}

function resolveClerkKeys(input: ClerkIntegrationInput): ResolvedClerkConfig {
  const publishableKey =
    input.publishableKey ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.CLERK_PUBLISHABLE_KEY ??
    "";
  const secretKey = input.secretKey ?? process.env.CLERK_SECRET_KEY ?? "";

  if (!publishableKey || !secretKey) {
    throw new Error(
      "Clerk integration requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.",
    );
  }

  return {
    publishableKey,
    secretKey,
  };
}

export function clerk(input: ClerkIntegrationInput = {}) {
  const { publishableKey, secretKey } = resolveClerkKeys(input);
  const protectedMatchers = normalizeMatchers(input.protectedRoutes);
  const signInUrl = input.signInUrl ?? "/sign-in";
  const signUpUrl = input.signUpUrl ?? "/sign-up";

  let cachedClient: ClerkClient | null = null;
  const getClient = () => {
    if (cachedClient) {
      return cachedClient;
    }

    cachedClient = createClerkClient({
      publishableKey,
      secretKey,
    });
    return cachedClient;
  };

  return defineIntegration({
    category: "auth",
    type: "clerk",
    instance: {
      publishableKey,
      secretKey: "[redacted]",
      protectedRoutes: protectedMatchers,
    },
    config: integrationConfig<ResolvedClerkConfig>({
      label: "Clerk integration",
      env: {
        publishableKey: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_PUBLISHABLE_KEY"],
        secretKey: "CLERK_SECRET_KEY",
      },
      input: {
        publishableKey,
        secretKey,
      },
      required: ["publishableKey", "secretKey"],
    }),
    log: input.log,
    providers: [
      {
        name: "clerk-provider",
        type: "clerk",
        props: {
          publishableKey,
          ...input.providerProps,
        },
      },
    ],
    documentNavigations: [
      {
        matcher: createDocumentNavigationMatchers(signInUrl, signUpUrl),
      },
    ],
    middleware:
      protectedMatchers.length > 0
        ? [
            {
              matcher: protectedMatchers,
              async handler(request: Request) {
                const clerkClient = getClient();
                const requestUrl = new URL(request.url);
                const pathname = requestUrl.pathname;
                const requestState = await clerkClient.authenticateRequest(request, {
                  authorizedParties: input.authorizedParties?.length
                    ? input.authorizedParties
                    : [requestUrl.origin],
                });

                const headers = new Headers(requestState.headers);
                const location = headers.get("location");
                const hasHandshakeParam = requestUrl.searchParams.has("__clerk_handshake");

                if (hasHandshakeParam && !requestState.isAuthenticated) {
                  const redirectUrl = new URL(signInUrl, request.url);
                  redirectUrl.searchParams.set("redirect_url", pathname);
                  headers.set("location", redirectUrl.toString());

                  return new Response(null, {
                    status: 307,
                    headers,
                  });
                }

                const shouldForwardClerkResponse =
                  requestState.status === "handshake" || (!!location && headers.has("set-cookie"));

                if (shouldForwardClerkResponse) {
                  return new Response(null, {
                    status: 307,
                    headers,
                  });
                }

                if (!requestState.isAuthenticated) {
                  const redirectUrl = new URL(signInUrl, request.url);
                  redirectUrl.searchParams.set("redirect_url", pathname);
                  return Response.redirect(redirectUrl, 307);
                }
              },
            },
          ]
        : [],
  });
}
