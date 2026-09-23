import { createIntegrationOrm } from "@farm.js/core";
import { createServerFn } from "@farm.js/core/server-fn";
import { getStorage } from "@farm.js/core/storage";
import { schema } from "./schema";

/**
 * The same orm-over-storage path the sync plugin uses, so the action and the
 * synced rows read and write identical data. Swap the mount for a real
 * database and this file does not change.
 */
type TaskRow = {
  id: string;
  title: string;
  status: "open" | "done";
  listId: string;
  updatedAt?: string;
};

type TasksOrm = {
  tasks: {
    findFirst(args: { where: Record<string, unknown> }): Promise<TaskRow | null>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<TaskRow>;
  };
};

let ormPromise: Promise<TasksOrm> | undefined;
const orm = () => {
  ormPromise ??= createIntegrationOrm({
    schema,
    client: getStorage("app"),
  }) as Promise<TasksOrm>;
  return ormPromise;
};

/** The per-browser list this demo scopes by, same cookie the sync filter reads. */
function listIdFrom(request: Request | undefined): string {
  const cookie = request?.headers.get("cookie") ?? "";
  return cookie.match(/farm_list=([^;]+)/)?.[1] ?? "demo";
}

/**
 * A transition the browser is not allowed to decide: only an open task can be
 * completed, and the rule lives here, next to the data. The client shows the
 * optimistic result instantly; a refusal rolls it back on screen.
 */
export const completeTask = createServerFn({
  async handler({ input, request }) {
    const { id } = (input ?? {}) as { id?: string };
    if (!id) throw new Error("completeTask needs a task id.");

    const db = await orm();
    const task = await db.tasks.findFirst({ where: { id, listId: listIdFrom(request) } });
    if (!task) throw new Error("No such task in this list.");
    if (task.status !== "open") throw new Error("Only an open task can be completed.");

    return db.tasks.update({
      where: { id },
      // Stamp the cursor so other devices pick the change up incrementally.
      data: { status: "done", updatedAt: new Date().toISOString() },
    });
  },
});
