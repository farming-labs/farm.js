import { defineCron } from "@farmjs/core/workflows";

export default defineCron({
  id: "daily-cleanup",
  schedule: "0 2 * * *",
  description: "Example scheduled cleanup task.",

  async run(ctx) {
    ctx.log.info("daily cleanup ran", ctx.scheduledTime ?? "manual");

    return {
      deleted: 0,
    };
  },
});
