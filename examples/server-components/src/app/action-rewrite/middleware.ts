import { middleware } from "@farm.js/core/middleware";

// /action-rewrite/alias shows /action-rewrite under its own URL.
export default middleware().when(
  (ctx) => ctx.pathname === "/action-rewrite/alias",
  async (ctx, next) => {
    ctx.rewrite("/action-rewrite");
    await next();
  },
);
