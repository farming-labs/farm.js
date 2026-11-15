import type { MiddlewareContext } from "@farm.js/core/middleware";

export function middleware(_request: Request, context: MiddlewareContext) {
  context.locals.set("user", "Ada");
}
