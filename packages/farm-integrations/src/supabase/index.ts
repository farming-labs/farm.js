import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  defineIntegration,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
} from "@farmjs/core";
import { api as clientApi } from "@farmjs/core/client";
import {
  createPathInferredClientApi,
  createDocumentNavigationMatchers,
  escapeHtml,
  getOrigin,
  getReturnTo,
  integrationConfig,
  normalizeMatchers,
  parseCookieHeaderList,
  resolveAppPath,
  resolveCallbackSettings,
  toAbsoluteUrl,
  withSearchParams,
} from "../utils/index.js";
import {
  supabaseClient,
  supabaseAuthFormFields,
  type SupabaseCredentials,
  type SupabaseLogoutInput,
  type SupabaseOAuthInput,
  type SupabaseRedirectResult,
  type SupabaseSessionResult,
  type SupabaseSignUpResult,
} from "./client.js";

type SupabasePageMode = "sign-in" | "sign-up";

interface SupabasePageFeedback {
  tone: "error" | "success";
  message: string;
}

export interface SupabaseIntegrationPages {
  signIn?: string;
  signUp?: string;
}

export interface SupabaseIntegrationInput {
  url?: string;
  anonKey?: string;
  appBaseUrl?: string;
  callbackUrl?: string;
  loginPath?: string;
  signupPath?: string;
  callbackPath?: string;
  logoutPath?: string;
  sessionPath?: string;
  protectedRoutes?: string | string[];
  providers?: string[];
  defaultProvider?: string;
  pages?: SupabaseIntegrationPages;
  log?: FarmIntegrationLogger;
}

interface ResolvedSupabaseEnv {
  url: string;
  anonKey: string;
  appBaseUrl?: string;
}

interface ResolvedSupabasePages {
  signIn?: string;
  signUp?: string;
}

interface SupabaseAPIInput {
  loginPath?: string;
  signupPath?: string;
  logoutPath?: string;
  sessionPath?: string;
}

interface RenderAuthPageInput {
  mode: SupabasePageMode;
  context: FarmIntegrationHandlerContext;
  loginPath: string;
  signupPath: string;
  signInViewPath: string;
  signUpViewPath: string;
  providers: string[];
  defaultProvider?: string;
  feedback?: SupabasePageFeedback;
}

function createSupabaseApi(input: SupabaseAPIInput = {}) {
  const loginPath = input.loginPath ?? "/auth/login";
  const signupPath = input.signupPath ?? "/auth/signup";
  const logoutPath = input.logoutPath ?? "/auth/logout";
  const sessionPath = input.sessionPath ?? "/auth/session";

  return createPathInferredClientApi(
    {
      path: loginPath,
      operation: clientApi.post<SupabaseCredentials, SupabaseRedirectResult>(loginPath),
    },
    {
      path: signupPath,
      operation: clientApi.post<SupabaseCredentials, SupabaseSignUpResult>(signupPath),
    },
    {
      path: loginPath,
      leafName: "oauth",
      operation: clientApi.get<SupabaseOAuthInput, SupabaseRedirectResult>(loginPath, {
        responseFormat: "json",
      }),
    },
    {
      path: logoutPath,
      operation: clientApi.post<SupabaseLogoutInput, SupabaseRedirectResult>(logoutPath),
    },
    {
      path: sessionPath,
      operation: clientApi.get<SupabaseSessionResult>(sessionPath, {
        responseFormat: "json",
      }),
    },
  );
}

function resolveEnv(input: SupabaseIntegrationInput): ResolvedSupabaseEnv {
  const url = input.url ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    input.anonKey ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    "";
  const appBaseUrl = input.appBaseUrl ?? process.env.APP_BASE_URL ?? undefined;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase integration requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY (or a Supabase publishable key env).",
    );
  }

  return {
    url,
    anonKey,
    appBaseUrl,
  };
}

function resolvePages(input: SupabaseIntegrationInput): ResolvedSupabasePages {
  return {
    signIn: resolveAppPath(input.pages?.signIn, "Supabase integration pages.signIn"),
    signUp: resolveAppPath(input.pages?.signUp, "Supabase integration pages.signUp"),
  };
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  parts.push(`Path=${options.path || "/"}`);

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite) {
    const sameSite =
      typeof options.sameSite === "string"
        ? options.sameSite
        : options.sameSite === true
          ? "Strict"
          : undefined;
    if (sameSite) {
      parts.push(`SameSite=${sameSite}`);
    }
  }

  return parts.join("; ");
}

function appendSetCookies(headers: Headers, cookies: string[]) {
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
}

function formatProviderLabel(provider: string): string {
  return provider
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function redirectToPage(
  pagePath: string,
  context: FarmIntegrationHandlerContext,
  configuredBaseUrl: string | undefined,
  params: Record<string, string | null | undefined>,
) {
  const targetUrl = withSearchParams(
    toAbsoluteUrl(pagePath, context.request, configuredBaseUrl),
    params,
  );

  return Response.redirect(targetUrl, 302);
}

function readPageFeedback(
  context: FarmIntegrationHandlerContext,
): SupabasePageFeedback | undefined {
  const error = context.url.searchParams.get("error");
  if (error) {
    return {
      tone: "error",
      message: normalizeSupabaseMessage(error),
    };
  }

  const message = context.url.searchParams.get("message");
  if (!message) {
    return undefined;
  }

  if (message === "check-email") {
    const email = context.url.searchParams.get("email");
    return {
      tone: "success",
      message: email
        ? `Check ${email} to confirm your account, then sign in.`
        : "Check your email to confirm your account, then sign in.",
    };
  }

  return {
    tone: "success",
    message,
  };
}

function normalizeSupabaseMessage(message: string): string {
  if (/email rate limit exceeded/i.test(message)) {
    return "Email sending is rate-limited for this Supabase project right now. Wait a bit, use an existing account, or disable email confirmation for local development.";
  }

  if (/unsupported provider/i.test(message)) {
    return "This Supabase provider is not enabled on the current project.";
  }

  return message;
}

function isIntegrationClientRequest(request: Request): boolean {
  return request.headers.get("x-farm-integration-client") === "1";
}

function jsonSuccess<TData>(data: TData, headers?: HeadersInit): Response {
  return Response.json(data, {
    status: 200,
    headers,
  });
}

function jsonError(message: string, status = 400, headers?: HeadersInit): Response {
  return Response.json(
    {
      error: normalizeSupabaseMessage(message),
    },
    {
      status,
      headers,
    },
  );
}

function renderAuthPage(input: RenderAuthPageInput): Response {
  const requestUrl = input.context.url;
  const returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/dashboard");
  const title = input.mode === "sign-in" ? "Sign in" : "Sign up";

  if (input.mode === "sign-in" && input.defaultProvider) {
    const redirectUrl = new URL(input.loginPath, requestUrl.origin);
    redirectUrl.searchParams.set("provider", input.defaultProvider);
    redirectUrl.searchParams.set("returnTo", returnTo);
    return Response.redirect(redirectUrl, 302);
  }

  const providerButtons = input.providers
    .map((provider) => {
      const href = new URL(input.loginPath, requestUrl.origin);
      href.searchParams.set("provider", provider);
      href.searchParams.set("returnTo", returnTo);

      return `<a class="provider-link" href="${escapeHtml(href.toString())}">
        <span class="provider-mark">${escapeHtml(provider.charAt(0).toUpperCase())}</span>
        <span>Continue with ${escapeHtml(formatProviderLabel(provider))}</span>
      </a>`;
    })
    .join("");
  const feedbackBlock = input.feedback
    ? `<div class="notice notice-${input.feedback.tone}">${escapeHtml(input.feedback.message)}</div>`
    : "";
  const providerSection =
    providerButtons.length > 0
      ? `<div class="providers">
          <div class="section-divider"><span>Or continue with</span></div>
          <div class="provider-stack">${providerButtons}</div>
        </div>`
      : "";
  const signInUrl = new URL(input.signInViewPath, requestUrl.origin);
  signInUrl.searchParams.set("returnTo", returnTo);
  const signUpUrl = new URL(input.signUpViewPath, requestUrl.origin);
  signUpUrl.searchParams.set("returnTo", returnTo);
  const submitLabel = input.mode === "sign-in" ? "Sign in" : "Create account";
  const returnLabel =
    returnTo === "/dashboard" ? "Continue to /dashboard" : `Continue to ${returnTo}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Supabase ${input.mode === "sign-in" ? "Sign In" : "Sign Up"}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f8fafc;
        --ink: #0f172a;
        --muted: #475569;
        --line: #dbe3ef;
        --card: #ffffff;
        --panel: #09111f;
        --panel-ink: #dce8f7;
        --accent: #3ecf8e;
        --accent-deep: #1a8f5b;
        --error-bg: #fef2f2;
        --error-ink: #991b1b;
        --success-bg: #ecfdf5;
        --success-ink: #166534;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(62, 207, 142, 0.22), transparent 26%),
          linear-gradient(180deg, #050a14 0%, #09111f 42%, #f8fafc 42%, #f8fafc 100%);
        color: var(--ink);
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
      }
      .shell {
        width: min(1080px, 100%);
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(340px, 430px);
        gap: 28px;
        align-items: stretch;
      }
      .hero {
        min-height: 580px;
        padding: 40px;
        border-radius: 32px;
        background:
          radial-gradient(circle at top right, rgba(62, 207, 142, 0.2), transparent 28%),
          linear-gradient(155deg, #0c1728 0%, #050a14 100%);
        color: var(--panel-ink);
        box-shadow: 0 28px 70px rgba(2, 6, 23, 0.32);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.12);
        color: #dff7ea;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .badge-mark {
        width: 12px;
        height: 12px;
        border-radius: 4px;
        background: linear-gradient(135deg, #3ecf8e 0%, #1a8f5b 100%);
        transform: skew(-12deg);
      }
      .hero h1 {
        margin: 0 0 18px;
        font-size: clamp(44px, 7vw, 72px);
        line-height: 0.98;
        letter-spacing: -0.05em;
        color: #f8fafc;
      }
      .hero p {
        margin: 0;
        max-width: 420px;
        color: rgba(220, 232, 247, 0.82);
        font-size: 15px;
      }
      .card {
        background: var(--card);
        border-radius: 32px;
        padding: 28px;
        box-shadow: 0 26px 60px rgba(15, 23, 42, 0.12);
        display: flex;
        flex-direction: column;
        min-height: 580px;
      }
      .tabs {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        padding: 6px;
        border-radius: 999px;
        background: #eef4fb;
        margin-bottom: 24px;
      }
      .tab {
        padding: 11px 14px;
        border-radius: 999px;
        text-align: center;
        color: #526072;
        text-decoration: none;
        font-weight: 700;
      }
      .tab-active {
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
      }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--accent-deep);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .card h2 {
        margin: 0 0 18px;
        font-size: 30px;
        line-height: 1.05;
        letter-spacing: -0.04em;
      }
      .notice {
        margin: 0 0 18px;
        padding: 14px 16px;
        border-radius: 18px;
        font-weight: 600;
        line-height: 1.55;
      }
      .notice-error {
        background: var(--error-bg);
        color: var(--error-ink);
      }
      .notice-success {
        background: var(--success-bg);
        color: var(--success-ink);
      }
      form {
        display: grid;
        gap: 14px;
      }
      label {
        display: grid;
        gap: 7px;
        font-weight: 700;
        color: #0f172a;
      }
      input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px 16px;
        font: inherit;
        color: #0f172a;
        background: #fbfdff;
        outline: none;
      }
      input:focus {
        border-color: #73e1b0;
        box-shadow: 0 0 0 4px rgba(62, 207, 142, 0.12);
      }
      .submit {
        margin-top: 6px;
        border: 0;
        border-radius: 16px;
        padding: 15px 18px;
        background: linear-gradient(135deg, #3ecf8e 0%, #2ba26e 100%);
        color: #03110a;
        font-weight: 800;
        font-size: 15px;
        cursor: pointer;
      }
      .submit:hover {
        filter: brightness(1.02);
      }
      .section-divider {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 14px;
        margin: 18px 0 16px;
        color: #94a3b8;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .section-divider::before,
      .section-divider::after {
        content: "";
        height: 1px;
        background: var(--line);
      }
      .provider-stack {
        display: grid;
        gap: 10px;
      }
      .provider-link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--line);
        color: var(--ink);
        text-decoration: none;
        font-weight: 700;
        background: #ffffff;
      }
      .provider-link:hover {
        background: #f8fafc;
      }
      .provider-mark {
        width: 34px;
        height: 34px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: #eef4fb;
        color: #0f172a;
        font-size: 15px;
        font-weight: 800;
      }
      code {
        background: #eff6ff;
        color: #0f172a;
        border-radius: 10px;
        padding: 2px 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      @media (max-width: 920px) {
        main {
          padding: 20px;
        }
        .shell {
          grid-template-columns: 1fr;
        }
        .hero,
        .card {
          min-height: unset;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="shell">
        <section class="hero">
          <div>
            <span class="badge"><span class="badge-mark"></span> Supabase Auth</span>
            <h1>Secure access, server-first.</h1>
            <p>${escapeHtml(returnLabel)}</p>
          </div>
        </section>

        <section class="card">
          <nav class="tabs" aria-label="Auth mode">
            <a class="tab ${input.mode === "sign-in" ? "tab-active" : ""}" href="${escapeHtml(signInUrl.toString())}">Sign in</a>
            <a class="tab ${input.mode === "sign-up" ? "tab-active" : ""}" href="${escapeHtml(signUpUrl.toString())}">Sign up</a>
          </nav>

          <p class="eyebrow">Supabase x Farm</p>
          <h2>${escapeHtml(title)}</h2>
          ${feedbackBlock}

          <form method="post" action="${escapeHtml(
            input.mode === "sign-in" ? input.loginPath : input.signupPath,
          )}">
            <input type="hidden" name="${supabaseAuthFormFields.returnTo}" value="${escapeHtml(returnTo)}" />
            <label>
              <span>Email</span>
              <input name="${supabaseAuthFormFields.email}" type="email" required autocomplete="email" />
            </label>
            <label>
              <span>Password</span>
              <input name="${supabaseAuthFormFields.password}" type="password" required autocomplete="${input.mode === "sign-in" ? "current-password" : "new-password"}" />
            </label>
            <button class="submit" type="submit">${escapeHtml(submitLabel)}</button>
          </form>

          ${providerSection}
        </section>
      </section>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function renderCheckEmailPage(
  context: FarmIntegrationHandlerContext,
  signInViewPath: string,
  email: string,
  returnTo: string,
): Response {
  const requestUrl = context.url;
  const signInUrl = new URL(signInViewPath, requestUrl.origin);
  signInUrl.searchParams.set("returnTo", returnTo);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Check your email</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(62, 207, 142, 0.18), transparent 25%),
          linear-gradient(180deg, #07111d 0%, #0f172a 38%, #f8fafc 38%, #f8fafc 100%);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
      }
      section {
        width: min(520px, 100%);
        border-radius: 30px;
        background: #ffffff;
        padding: 30px;
        box-shadow: 0 26px 60px rgba(15, 23, 42, 0.16);
      }
      p:first-child {
        margin: 0 0 10px;
        color: #15803d;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 34px;
        line-height: 1.05;
        letter-spacing: -0.04em;
      }
      p {
        margin: 0 0 16px;
        color: #475569;
        line-height: 1.7;
      }
      a {
        color: #0f172a;
        font-weight: 800;
        text-decoration: none;
      }
      code {
        background: #eff6ff;
        color: #0f172a;
        border-radius: 10px;
        padding: 2px 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <section>
      <p>Supabase Auth</p>
      <h1>Check your email</h1>
      <p>Supabase created the account for <strong>${escapeHtml(email)}</strong>.</p>
      <p>Complete the email confirmation flow for this project, then sign in again to create a server session and reach <code>${escapeHtml(
        returnTo,
      )}</code>.</p>
      <a href="${escapeHtml(signInUrl.toString())}">Back to sign in</a>
    </section>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function createSupabaseHandler(
  context: Pick<FarmIntegrationHandlerContext, "request" | "requestContext">,
  env: ResolvedSupabaseEnv,
) {
  const setCookies: string[] = [];

  const supabase = createServerClient(env.url, env.anonKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
    },
    cookies: {
      getAll() {
        return parseCookieHeaderList(context.request.headers.get("cookie"));
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          setCookies.push(serializeCookie(cookie.name, cookie.value, cookie.options));
        }
        context.requestContext.set("supabase:set-cookies", [...setCookies]);
      },
    },
  });

  return {
    supabase,
    setCookies,
  };
}

async function parseEmailPasswordRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let payload: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    payload = ((await request.json()) as Record<string, unknown>) || {};
  } else {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      payload[key] = value;
    });
  }

  const email = String(payload[supabaseAuthFormFields.email] || "").trim();
  const password = String(payload[supabaseAuthFormFields.password] || "");
  const returnTo = getReturnTo(
    String(payload[supabaseAuthFormFields.returnTo] || ""),
    "/dashboard",
  );

  if (!email || !password) {
    return {
      ok: false as const,
      message: "Email and password are required.",
      returnTo,
      email,
    };
  }

  return {
    ok: true as const,
    email,
    password,
    returnTo,
  };
}

export function supabase(input: SupabaseIntegrationInput = {}) {
  const env = resolveEnv(input);
  const pages = resolvePages(input);
  const providers = input.providers || [];
  const protectedMatchers = normalizeMatchers(input.protectedRoutes);
  const loginPath = input.loginPath ?? "/auth/login";
  const signupPath = input.signupPath ?? "/auth/signup";
  const logoutPath = input.logoutPath ?? "/auth/logout";
  const sessionPath = input.sessionPath ?? "/auth/session";
  const signInViewPath = pages.signIn ?? loginPath;
  const signUpViewPath = pages.signUp ?? signupPath;
  const callbackSettings = resolveCallbackSettings(
    {
      callbackUrl: input.callbackUrl,
      callbackPath: input.callbackPath,
      defaultPath: "/auth/callback",
      label: "Supabase integration",
    },
    env.appBaseUrl,
  );
  const callbackPath = callbackSettings.callbackPath;
  const api = createSupabaseApi({
    loginPath,
    signupPath,
    logoutPath,
    sessionPath,
  });

  return defineIntegration({
    category: "auth",
    type: "supabase",
    instance: {
      url: env.url,
      protectedRoutes: protectedMatchers,
      providers,
      pages,
    },
    config: integrationConfig<ResolvedSupabaseEnv>({
      label: "Supabase integration",
      env: {
        url: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
        anonKey: [
          "SUPABASE_ANON_KEY",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "SUPABASE_PUBLISHABLE_KEY",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
        ],
        appBaseUrl: "APP_BASE_URL",
      },
      input: env,
      required: ["url", "anonKey"],
    }),
    api,
    log: input.log,
    documentNavigations: [
      {
        matcher: createDocumentNavigationMatchers(
          loginPath,
          signupPath,
          callbackPath,
          logoutPath,
          pages.signIn,
          pages.signUp,
        ),
      },
    ],
    routes: [
      {
        path: loginPath,
        methods: ["GET", "POST"],
        async handler(_request: Request, context: FarmIntegrationHandlerContext) {
          const request = context.request;
          const requestUrl = context.url;
          const clientRequest = isIntegrationClientRequest(request);
          const provider = requestUrl.searchParams.get("provider") || input.defaultProvider;
          const returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/dashboard");

          if (request.method === "POST") {
            const parsedRequest = await parseEmailPasswordRequest(request);
            if (!parsedRequest.ok) {
              if (clientRequest) {
                return jsonError(parsedRequest.message, 400);
              }

              if (pages.signIn && pages.signIn !== loginPath) {
                return redirectToPage(pages.signIn, context, env.appBaseUrl, {
                  returnTo: parsedRequest.returnTo,
                  error: parsedRequest.message,
                });
              }

              return renderAuthPage({
                mode: "sign-in",
                context,
                loginPath,
                signupPath,
                signInViewPath,
                signUpViewPath,
                providers,
                defaultProvider: input.defaultProvider,
                feedback: {
                  tone: "error",
                  message: parsedRequest.message,
                },
              });
            }

            const { supabase, setCookies } = createSupabaseHandler(context, env);
            const { error } = await supabase.auth.signInWithPassword({
              email: parsedRequest.email,
              password: parsedRequest.password,
            });

            if (error) {
              const message = normalizeSupabaseMessage(error.message);
              if (clientRequest) {
                return jsonError(message, 400);
              }

              if (pages.signIn && pages.signIn !== loginPath) {
                return redirectToPage(pages.signIn, context, env.appBaseUrl, {
                  returnTo: parsedRequest.returnTo,
                  error: message,
                });
              }

              return renderAuthPage({
                mode: "sign-in",
                context,
                loginPath,
                signupPath,
                signInViewPath,
                signUpViewPath,
                providers,
                defaultProvider: input.defaultProvider,
                feedback: {
                  tone: "error",
                  message,
                },
              });
            }

            const headers = new Headers();
            appendSetCookies(headers, setCookies);
            const redirectTo = new URL(
              parsedRequest.returnTo,
              getOrigin(context.request, env.appBaseUrl),
            ).toString();

            if (clientRequest) {
              return jsonSuccess<SupabaseRedirectResult>(
                {
                  redirectTo,
                },
                headers,
              );
            }

            headers.set("location", redirectTo);

            return new Response(null, {
              status: 302,
              headers,
            });
          }

          if (!provider && pages.signIn && pages.signIn !== loginPath) {
            return redirectToPage(pages.signIn, context, env.appBaseUrl, {
              returnTo,
              error: requestUrl.searchParams.get("error"),
              message: requestUrl.searchParams.get("message"),
              email: requestUrl.searchParams.get("email"),
            });
          }

          if (!provider) {
            return renderAuthPage({
              mode: "sign-in",
              context,
              loginPath,
              signupPath,
              signInViewPath,
              signUpViewPath,
              providers,
              defaultProvider: input.defaultProvider,
              feedback: readPageFeedback(context),
            });
          }

          const { supabase, setCookies } = createSupabaseHandler(context, env);
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: provider as any,
            options: {
              redirectTo: callbackSettings.getCallbackUrl(context.request, { returnTo }),
            },
          });

          if (error || !data.url) {
            const message = error?.message || "Failed to start Supabase OAuth sign-in.";
            if (clientRequest) {
              return jsonError(message, 500);
            }

            return new Response(message, {
              status: 500,
            });
          }

          const headers = new Headers();
          appendSetCookies(headers, setCookies);

          if (clientRequest) {
            return jsonSuccess<SupabaseRedirectResult>(
              {
                redirectTo: data.url,
              },
              headers,
            );
          }

          headers.set("location", data.url);

          return new Response(null, {
            status: 302,
            headers,
          });
        },
      },
      {
        path: signupPath,
        methods: ["GET", "POST"],
        async handler(_request: Request, context: FarmIntegrationHandlerContext) {
          const request = context.request;
          const requestUrl = context.url;
          const clientRequest = isIntegrationClientRequest(request);
          const returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/dashboard");

          if (request.method === "GET") {
            if (pages.signUp && pages.signUp !== signupPath) {
              return redirectToPage(pages.signUp, context, env.appBaseUrl, {
                returnTo,
                error: requestUrl.searchParams.get("error"),
                message: requestUrl.searchParams.get("message"),
                email: requestUrl.searchParams.get("email"),
              });
            }

            return renderAuthPage({
              mode: "sign-up",
              context,
              loginPath,
              signupPath,
              signInViewPath,
              signUpViewPath,
              providers,
              feedback: readPageFeedback(context),
            });
          }

          const parsedRequest = await parseEmailPasswordRequest(context.request);
          if (!parsedRequest.ok) {
            if (clientRequest) {
              return jsonError(parsedRequest.message, 400);
            }

            if (pages.signUp && pages.signUp !== signupPath) {
              return redirectToPage(pages.signUp, context, env.appBaseUrl, {
                returnTo: parsedRequest.returnTo,
                error: parsedRequest.message,
              });
            }

            return renderAuthPage({
              mode: "sign-up",
              context,
              loginPath,
              signupPath,
              signInViewPath,
              signUpViewPath,
              providers,
              feedback: {
                tone: "error",
                message: parsedRequest.message,
              },
            });
          }

          const { supabase, setCookies } = createSupabaseHandler(context, env);
          const { data, error } = await supabase.auth.signUp({
            email: parsedRequest.email,
            password: parsedRequest.password,
            options: {
              emailRedirectTo: callbackSettings.getCallbackUrl(context.request, {
                returnTo: parsedRequest.returnTo,
              }),
            },
          });

          if (error) {
            const message = normalizeSupabaseMessage(error.message);
            if (clientRequest) {
              return jsonError(message, 400);
            }

            if (pages.signUp && pages.signUp !== signupPath) {
              return redirectToPage(pages.signUp, context, env.appBaseUrl, {
                returnTo: parsedRequest.returnTo,
                error: message,
              });
            }

            return renderAuthPage({
              mode: "sign-up",
              context,
              loginPath,
              signupPath,
              signInViewPath,
              signUpViewPath,
              providers,
              feedback: {
                tone: "error",
                message,
              },
            });
          }

          const headers = new Headers();
          appendSetCookies(headers, setCookies);

          if (data.session) {
            const redirectTo = new URL(
              parsedRequest.returnTo,
              getOrigin(context.request, env.appBaseUrl),
            ).toString();

            if (clientRequest) {
              return jsonSuccess<SupabaseSignUpResult>(
                {
                  redirectTo,
                },
                headers,
              );
            }

            headers.set("location", redirectTo);

            return new Response(null, {
              status: 302,
              headers,
            });
          }

          const signInRedirectTo = toAbsoluteUrl(signInViewPath, context.request, env.appBaseUrl);
          signInRedirectTo.searchParams.set("returnTo", parsedRequest.returnTo);
          signInRedirectTo.searchParams.set("message", "check-email");
          signInRedirectTo.searchParams.set("email", parsedRequest.email);

          if (clientRequest) {
            return jsonSuccess<SupabaseSignUpResult>(
              {
                redirectTo: signInRedirectTo.toString(),
                emailConfirmationRequired: true,
                email: parsedRequest.email,
                message: `Check ${parsedRequest.email} to confirm your account, then sign in.`,
              },
              headers,
            );
          }

          if (pages.signIn && pages.signIn !== loginPath) {
            return redirectToPage(pages.signIn, context, env.appBaseUrl, {
              returnTo: parsedRequest.returnTo,
              message: "check-email",
              email: parsedRequest.email,
            });
          }

          return renderCheckEmailPage(
            context,
            signInViewPath,
            parsedRequest.email,
            parsedRequest.returnTo,
          );
        },
      },
      {
        path: callbackPath,
        methods: ["GET"],
        async handler(_request: Request, context: FarmIntegrationHandlerContext) {
          const requestUrl = context.url;
          const code = requestUrl.searchParams.get("code");
          const returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/dashboard");

          if (!code) {
            return new Response("Missing Supabase authorization code.", { status: 400 });
          }

          const { supabase, setCookies } = createSupabaseHandler(context, env);
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            return new Response(error.message, { status: 500 });
          }

          const headers = new Headers();
          appendSetCookies(headers, setCookies);
          headers.set(
            "location",
            new URL(returnTo, getOrigin(context.request, env.appBaseUrl)).toString(),
          );

          return new Response(null, {
            status: 302,
            headers,
          });
        },
      },
      {
        path: logoutPath,
        methods: ["GET", "POST"],
        async handler(_request: Request, context: FarmIntegrationHandlerContext) {
          const request = context.request;
          const requestUrl = context.url;
          let returnTo = getReturnTo(requestUrl.searchParams.get("returnTo"), "/");
          const clientRequest = isIntegrationClientRequest(request);

          if (request.method === "POST") {
            const contentType = context.request.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
              const payload = ((await context.request.json()) as SupabaseLogoutInput) || {};
              returnTo = getReturnTo(payload.returnTo, returnTo);
            }
          }

          const { supabase, setCookies } = createSupabaseHandler(context, env);
          const { error } = await supabase.auth.signOut();
          if (error) {
            if (clientRequest) {
              return jsonError(error.message, 500);
            }

            return new Response(error.message, { status: 500 });
          }

          const headers = new Headers();
          appendSetCookies(headers, setCookies);
          const redirectTo = new URL(
            returnTo,
            getOrigin(context.request, env.appBaseUrl),
          ).toString();

          if (clientRequest) {
            return jsonSuccess<SupabaseRedirectResult>(
              {
                redirectTo,
              },
              headers,
            );
          }

          headers.set("location", redirectTo);

          return new Response(null, {
            status: 302,
            headers,
          });
        },
      },
      {
        path: sessionPath,
        methods: ["GET"],
        async handler(_request: Request, context: FarmIntegrationHandlerContext) {
          console.log({ context });
          const { supabase, setCookies } = createSupabaseHandler(context, env);
          const { data, error } = await supabase.auth.getUser();

          const headers = new Headers({
            "content-type": "application/json",
          });
          appendSetCookies(headers, setCookies);

          if (error || !data.user) {
            return new Response(JSON.stringify({ authenticated: false }), {
              status: 401,
              headers,
            });
          }

          return new Response(
            JSON.stringify({
              authenticated: true,
              user: data.user,
            }),
            {
              status: 200,
              headers,
            },
          );
        },
      },
    ],
    middleware:
      protectedMatchers.length > 0
        ? [
            {
              matcher: protectedMatchers,
              async handler(_request: Request, context: FarmIntegrationHandlerContext) {
                const { supabase } = createSupabaseHandler(context, env);
                const {
                  data: { session },
                } = await supabase.auth.getSession();

                if (session) {
                  return;
                }

                return redirectToPage(signInViewPath, context, env.appBaseUrl, {
                  returnTo: `${context.url.pathname}${context.url.search}`,
                });
              },
            },
          ]
        : [],
  });
}
