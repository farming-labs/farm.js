import { auth } from "@farm.js/auth/server";

export const config = {
  runtime: "nodejs" as const,
};

export async function middleware(request: Request) {
  const user = await auth.user({ request });

  if (!user) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}
