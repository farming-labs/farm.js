export const config = {
  matcher: "/redirect-e2e/guarded",
};

export function middleware(request: Request) {
  return Response.redirect(new URL("/redirect-e2e/target?from=middleware", request.url), 307);
}
