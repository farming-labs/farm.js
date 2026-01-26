/**
 * Farm Query Demo middleware - demonstrates page-specific middleware
 */
import { middleware, MiddlewareContext } from "farm/middleware";

const authRequest = async (ctx: MiddlewareContext, next: () => Promise<void>) => {
  const authHeader = ctx.request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    if (token === "demo-token-123") {
      await next();
    }
  }
};
const otherCheck = async (ctx: MiddlewareContext, next: () => Promise<void>) => {};
export default middleware()
  .use(async (ctx, next) => {
    ctx.data.set("demoInfo", {
      message: "This data wasnt set by middleware!",
      timestamp: new Date().toISOString(),
    });
    // modify the response
    await ctx.response.writeHead(200, {
      "Content-Type": "text/html",
      "X-Powered-By": "Farm.js",
    });
    // modify the request
    await ctx.request;
    await ctx.response.end("Hello World");
    await next();
  })
  .use(authRequest)
  .use(otherCheck)
  .when("/api", (ctx, next) => {
    ctx.json(
      {
        message: "Hello World",
      },
      200,
    );
    next();
  })
  .rateLimit({
    requests: 100, // 100 requests
    window: "1m", // per minute
    keyGenerator: (ctx) => {
      const ip = ctx.request.socket.remoteAddress || "unknown";
      const userId = ctx.data.get("user")?.id;
      return userId ? `user_${userId}` : `ip_${ip}`;
    },
    onLimit: async (ctx) => {
      console.log("⚠️  Rate limit exceeded for:", ctx.pathname);

      // Custom rate limit response
      ctx.data.set("rateLimited", true);
      ctx.json(
        {
          error: "Too many requests",
          message: "Please slow down and try again later",
          retryAfter: 60,
        },
        429,
      );
    },
  })
  .when("/docs-old", async (ctx, next) => {
    ctx.redirect("/docs");
    await next();
  })
  .rewrite("/docs-old", "/docs")
  .redirect("/contact-us", "/contact", false); // 307 temporary redirect
