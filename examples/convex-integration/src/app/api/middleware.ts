import { convexRateLimitStorage } from "@farm.js/convex";
import { middleware } from "@farm.js/core/middleware";

export default middleware().rateLimit({
  requests: 30,
  window: "1m",
  storage: convexRateLimitStorage(),
});
