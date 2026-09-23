import { createEndpoint, createIntegrationOrm } from "@farm.js/core";
import { getStorage } from "@farm.js/core/storage";
import { z } from "zod";
import { schema } from "../../../../schema";

/**
 * The same orm-over-storage path the sync plugin uses, so this rule and the
 * synced rows read and write identical data. Swap the mount for a real
 * database and the rule does not change.
 */
let ormPromise: ReturnType<typeof buildOrm> | undefined;
const buildOrm = () => createIntegrationOrm({ schema, client: getStorage("app") });
const orm = () => (ormPromise ??= buildOrm());

/**
 * A transition the browser is not allowed to decide: only an open task can be
 * completed, and the rule lives here, next to the data. The client shows the
 * optimistic result instantly; this endpoint refusing rolls it back on screen.
 */
export const POST = createEndpoint(
  "/api/tasks/complete",
  {
    method: "POST",
    body: z.object({ id: z.string().min(1) }),
    errors: {
      not_found: { status: 404, message: "No such task in this list.", data: z.object({}) },
      not_open: { status: 409, message: "Only an open task can be completed.", data: z.object({}) },
    },
  },
  async (ctx) => {
    const { body: { id }, error } = ctx;

    // Same per-browser scope the sync row filter uses.
    const cookie = ctx.request.headers.get("cookie") ?? "";
    const listId = cookie.match(/farm_list=([^;]+)/)?.[1] ?? "demo";

    const db = await orm();
    const task = await db.tasks.findFirst({ where: { id, listId } });
    if (!task) return error("not_found", {});
    if (task.status !== "open") return error("not_open", {});

    return db.tasks.update({
      where: { id },
      // Stamp the cursor so other devices pick the change up incrementally.
      data: { status: "done", updatedAt: new Date() },
    });
  },
);
