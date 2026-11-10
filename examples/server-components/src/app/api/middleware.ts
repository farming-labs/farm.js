import { middleware } from "@farm.js/core/middleware";

// Runs for the API routes below it, in both engines. (App-level middleware keeps every page
// request-time, so the static pages would not prerender.)
export default middleware()
  .use(async (ctx, next) => {
    ctx.headers.set("X-Contract-Middleware", "api");
    await next();
  })
  .when(
    (ctx) => ctx.pathname === "/api/alias",
    async (ctx, next) => {
      ctx.rewrite("/api/echo?word=rewritten");
      await next();
    },
  );
