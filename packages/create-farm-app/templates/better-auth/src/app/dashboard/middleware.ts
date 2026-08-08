import { auth } from "../../lib/auth";

export const config = {
  runtime: "nodejs" as const,
};

export async function middleware(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}
