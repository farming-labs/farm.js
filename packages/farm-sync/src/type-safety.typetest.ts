/**
 * Compile-time contract for the generated SyncModels map. Never imported at
 * runtime; `pnpm --filter @farm.js/sync type-check` fails if any expectation
 * breaks. Mirrors what the generated farm.d.ts does in an app.
 */
import { useLiveQuery, useSyncAction } from "./react.js";

declare module "./client.js" {
  interface SyncModels {
    tasks: { id: string; title: string; status: "open" | "done" | "archived" };
    lists: { id: string; name: string };
  }
  interface SyncModelInputs {
    tasks: { id?: string; title: string; status?: "open" | "done" | "archived" };
    lists: { id?: string; name: string };
  }
}

export function compileTimeContract() {
  const tasks = useLiveQuery("tasks", (t) => t.status === "open");

  // Rows and writes are typed from the model the first argument names.
  const title: string = tasks.rows[0]!.title;
  tasks.insert({ title: "typed" }); // id and status optional per the input map
  tasks.update("t1", { status: "done" });
  const persisted: boolean = tasks.isPersisted(tasks.rows[0]!);

  // @ts-expect-error unknown model name
  useLiveQuery("task", () => true);
  // @ts-expect-error no such field on tasks
  useLiveQuery("tasks", (t) => t.stauts === "open");
  // @ts-expect-error "opne" is outside the enum union
  useLiveQuery("tasks", (t) => t.status === "opne");
  // @ts-expect-error the row type follows the named model: lists has no status
  useLiveQuery("lists", (t) => t.status === "open");
  // @ts-expect-error unknown insert field
  tasks.insert({ titel: "typo" });
  // @ts-expect-error title is required on insert
  tasks.insert({ status: "open" });

  const complete = useSyncAction((input: { id: string }) => Promise.resolve(input), "tasks", {
    optimistic: { status: "done" },
  });
  const handle = complete({ id: "t1" });

  // The function form works too when the patch depends on the input.
  useSyncAction((input: { id: string; note: string }) => Promise.resolve(input), "tasks", {
    optimistic: (input) => ({ title: input.note }),
  });

  // @ts-expect-error unknown model on an action binding
  useSyncAction((input: { id: string }) => Promise.resolve(input), "task");
  useSyncAction((input: { id: string }) => Promise.resolve(input), "tasks", {
    // @ts-expect-error the optimistic patch is checked against the model's row
    optimistic: { status: "opne" },
  });

  return { title, persisted, handle };
}
