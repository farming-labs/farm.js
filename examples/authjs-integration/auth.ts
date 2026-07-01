type NextAuthOptions = {
  providers: string[];
};

type DemoUser = {
  email: string;
  name: string;
};

const sessionCookieName = "farm_authjs_session";

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.split("=");
        return [key, decodeURIComponent(rest.join("="))];
      }),
  );
}

function getSessionUser(request: Request): DemoUser | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  const raw = cookies[sessionCookieName];

  if (!raw) return null;

  try {
    return JSON.parse(raw) as DemoUser;
  } catch {
    return null;
  }
}

function buildSessionCookie(user: DemoUser) {
  return `${sessionCookieName}=${encodeURIComponent(JSON.stringify(user))}; Path=/; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function resolveAction(pathname: string) {
  const segment = pathname.split("/").filter(Boolean).pop();

  if (segment === "session") return "session";
  if (segment === "signin" || segment === "sign-in") return "sign-in";
  if (segment === "signout" || segment === "sign-out" || segment === "logout") return "sign-out";

  return "unknown";
}

function NextAuth(options: NextAuthOptions) {
  async function call(path: string, method: "GET" | "POST") {
    const response = await fetch(path, { method });
    const body = await response.text();

    return {
      status: response.status,
      body,
    };
  }

  async function handler(request: Request) {
    const pathname = new URL(request.url).pathname;
    const action = resolveAction(pathname);
    const method = request.method.toUpperCase();
    const user = getSessionUser(request);

    if (action === "unknown") {
      return Response.json({ ok: true, provider: "authjs", providers: options.providers, method, path: pathname });
    }

    if (action === "session") {
      if (!user) {
        return Response.json(
          {
            ok: false,
            provider: "authjs",
            action,
            source: "auth-instance",
          },
          { status: 401 },
        );
      }

      return Response.json({
        ok: true,
        provider: "authjs",
        action,
        method,
        source: "auth-instance",
        providers: options.providers,
        user,
      });
    }

    if (action === "sign-out") {
      return new Response(
        JSON.stringify({
          ok: true,
          provider: "authjs",
          action,
          method,
          source: "auth-instance",
          providers: options.providers,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": clearSessionCookie(),
          },
        },
      );
    }

    const demoUser = {
      email: "person@farmjs.dev",
      name: "GitHub Demo User",
    };

    return new Response(
      JSON.stringify({
        ok: true,
        provider: "authjs",
        action,
        method,
        source: "auth-instance",
        providers: options.providers,
        user: demoUser,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": buildSessionCookie(demoUser),
        },
      },
    );
  }

  return {
    handlers: {
      GET: handler,
      POST: handler,
    },
    signIn(_provider = "github") {
      return call("/api/auth/signin", "GET");
    },
    signOut() {
      return call("/api/auth/signout", "POST");
    },
    auth() {
      return call("/api/auth/session", "GET");
    },
  };
}

const nextAuth = NextAuth({
  providers: ["github"],
});

export const { handlers, signIn, signOut, auth } = nextAuth;
export { nextAuth };
