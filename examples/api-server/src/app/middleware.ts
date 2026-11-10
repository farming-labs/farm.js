import type { RequestMiddlewareContext } from "@farm.js/core/middleware";

// The demo token is intentionally visible and local-only; use a real authentication
// integration in production.
const DEMO_TOKEN = "demo-token";
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Runs before every route: tags each response with a request ID, and requires the demo
// token for writes.
export function middleware(request: Request, context: RequestMiddlewareContext) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  context.headers.set("x-request-id", requestId);

  if (
    !READ_METHODS.has(request.method) &&
    request.headers.get("authorization") !== `Bearer ${DEMO_TOKEN}`
  ) {
    return Response.json(
      { error: "Unauthorized", hint: `Send Authorization: Bearer ${DEMO_TOKEN}` },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }
}
