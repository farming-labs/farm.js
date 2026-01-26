/**
 * Farm Query Demo middleware - demonstrates page-specific middleware
 */
import { middleware } from "farm/middleware";

export default middleware()
  .use(async (ctx, next) => {
    console.log("📊 Farm Query Demo page accessed");

    // Add some demo data that could be used by the page
    ctx.data.set("demoInfo", {
      message: "This data was set by middleware!",
      timestamp: new Date().toISOString(),
    });

    await next();
  })
  .rateLimit({
    requests: 10,
    window: "1m",
    keyGenerator: (ctx) => {
      return ctx.request.socket.remoteAddress || "unknown";
    },
  });
