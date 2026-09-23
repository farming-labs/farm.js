// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mutation lifecycle as the user experiences it: what is on screen at each
 * step, how many times the server was called, and what the counters read.
 *
 * Each test re-imports the runtime so the module-level store starts clean.
 */

const config = {
  path: "/_farm/sync",
  models: {
    tasks: {
      key: "id",
      access: "write" as const,
      persist: false,
      cursor: null,
      fields: ["id", "title", "status"],
    },
  },
};

type Runtime = typeof import("./client");

async function freshRuntime(): Promise<Runtime> {
  vi.resetModules();
  const mod = await import("./client");
  mod.startSyncRuntime(config, { retry: { count: 2, delay: 1 } });
  return mod;
}

/** Rows currently visible, which is what a live query renders. */
const visible = (mod: Runtime) => mod.getSyncStore("tasks").getRows();

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Answer the initial load, then delegate writes to `onWrite`. */
function serve(onWrite: (attempt: number) => Promise<Response>) {
  let writes = 0;
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.operation === "list") return json({ rows: [], cursor: null, full: true });
    writes += 1;
    return onWrite(writes);
  });
  return () => writes;
}

describe("mutation lifecycle", () => {
  it("shows the row immediately and removes it when the server rejects", async () => {
    const mod = await freshRuntime();
    const writes = serve(() =>
      json({ error: { code: "invalid_input", message: "rejected" } }, 400),
    );

    const handle = mod.db.tasks.insert({ title: "doomed" });

    // Visible before the network has answered: this is the whole point.
    expect(visible(mod).map((row) => row.title)).toEqual(["doomed"]);
    expect(mod.getSyncStore("tasks").pending).toBe(1);

    await expect(handle.persisted).rejects.toThrow(/rejected/);

    expect(visible(mod)).toHaveLength(0); // rolled back
    expect(mod.getSyncStore("tasks").pending).toBe(0);
    expect(handle.state).toBe("failed");
    expect(writes()).toBe(1); // a client error is final, never retried
  });

  it("keeps the row on screen across retries and commits the server's version", async () => {
    const mod = await freshRuntime();
    const writes = serve((attempt) =>
      attempt <= 2
        ? json({ error: { code: "server_error", message: "boom" } }, 500)
        : json({ id: "server-id", title: "kept", status: "open" }),
    );

    const handle = mod.db.tasks.insert({ title: "kept" });
    expect(visible(mod)).toHaveLength(1);

    await handle.persisted;

    // Never disappeared mid-flight, and now holds the confirmed row.
    expect(visible(mod)).toHaveLength(1);
    expect(visible(mod)[0]).toMatchObject({ id: "server-id", title: "kept" });
    expect(handle.state).toBe("completed");
    expect(writes()).toBe(3); // initial attempt plus two retries
    expect(mod.getSyncStore("tasks").pending).toBe(0);
  });

  it("gives up after retries are exhausted and drains the counter", async () => {
    const mod = await freshRuntime();
    const writes = serve(() => json({ error: { code: "server_error", message: "down" } }, 503));

    const handle = mod.db.tasks.insert({ title: "never lands" });
    expect(visible(mod)).toHaveLength(1);

    await expect(handle.persisted).rejects.toThrow(/down/);

    expect(visible(mod)).toHaveLength(0);
    expect(mod.getSyncStore("tasks").pending).toBe(0);
    expect(writes()).toBe(3);
  });

  it("restores the previous values when an update is rejected", async () => {
    const mod = await freshRuntime();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "list") {
        return json({
          rows: [{ id: "t1", title: "original", status: "open" }],
          cursor: null,
          full: true,
        });
      }
      return json({ error: { code: "not_found", message: "outside scope" } }, 404);
    });

    // Let the initial load land before mutating.
    await vi.waitFor(() => expect(visible(mod)).toHaveLength(1));

    const handle = mod.db.tasks.update({ id: "t1", status: "done" });
    expect(visible(mod)[0]).toMatchObject({ status: "done", title: "original" });

    await expect(handle.persisted).rejects.toThrow(/outside scope/);

    // Back to exactly what the server last confirmed.
    expect(visible(mod)[0]).toMatchObject({ id: "t1", title: "original", status: "open" });
  });

  it("can be awaited directly, without reaching for a property", async () => {
    const mod = await freshRuntime();
    serve(() => json({ id: "server-id", title: "awaited" }));

    // The handle is a thenable, so `await` works on the call itself.
    const row = await mod.db.tasks.insert({ title: "awaited" });
    expect(row).toMatchObject({ id: "server-id" });
  });

  it("rejects through a direct await and through .persisted alike", async () => {
    const mod = await freshRuntime();
    serve(() => json({ error: { code: "invalid_input", message: "nope" } }, 400));

    await expect(mod.db.tasks.insert({ title: "a" })).rejects.toThrow(/nope/);
    await expect(mod.db.tasks.insert({ title: "b" }).persisted).rejects.toThrow(/nope/);

    // Either way the optimistic rows are gone.
    expect(visible(mod)).toHaveLength(0);
  });

  it("supports .catch() on the handle for inline error handling", async () => {
    const mod = await freshRuntime();
    serve(() => json({ error: { code: "invalid_input", message: "inline" } }, 400));

    const seen: string[] = [];
    mod.db.tasks.insert({ title: "c" }).catch((cause: Error) => seen.push(cause.message));
    await vi.waitFor(() => expect(seen).toEqual(["inline"]));
  });

  it("does not raise an unhandled rejection for a fire-and-forget failure", async () => {
    const mod = await freshRuntime();
    serve(() => json({ error: { code: "invalid_input", message: "no" } }, 400));

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    mod.db.tasks.insert({ title: "ignored" }); // caller never awaits it or touches .persisted
    await new Promise((resolve) => setTimeout(resolve, 50));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(visible(mod)).toHaveLength(0);
  });
});

describe("durability lifecycle", () => {
  it("records a refused write in the failures queue with its input and reason", async () => {
    const mod = await freshRuntime();
    serve(() => json({ error: { code: "invalid_input", message: "title taken" } }, 400));

    mod.db.tasks.insert({ title: "dup" });
    const store = mod.getSyncStore("tasks");
    await vi.waitFor(() => expect(store.failures).toHaveLength(1));

    const failure = store.failures[0]!;
    expect(failure.operation).toBe("insert");
    expect(failure.input).toMatchObject({ title: "dup" });
    expect(failure.error.message).toMatch(/title taken/);
    expect(visible(mod)).toHaveLength(0); // rolled back on screen
  });

  it("retry re-applies the optimistic row, resends, and clears the entry on success", async () => {
    const mod = await freshRuntime();
    serve((attempt) =>
      attempt === 1 // a 400 is final, so the first send fails in one attempt
        ? json({ error: { code: "invalid_input", message: "flake" } }, 400)
        : json({ id: "t1", title: "second try", status: "open" }),
    );

    mod.db.tasks.insert({ title: "second try" });
    const store = mod.getSyncStore("tasks");
    await vi.waitFor(() => expect(store.failures).toHaveLength(1));

    const handle = store.failures[0]!.retry() as { persisted: Promise<unknown> };
    expect(store.failures).toHaveLength(0); // stale entry gone the moment retry starts

    // Await the server's confirmation, not just the optimistic re-apply.
    await handle.persisted;
    expect(visible(mod)).toHaveLength(1);
    expect(store.isPersisted({ id: "t1" })).toBe(true);
    expect(store.failures).toHaveLength(0);
  });

  it("a failed retry records once, not a duplicate per attempt", async () => {
    const mod = await freshRuntime();
    serve(() => json({ error: { code: "invalid_input", message: "always no" } }, 400));

    mod.db.tasks.insert({ title: "never" });
    const store = mod.getSyncStore("tasks");
    await vi.waitFor(() => expect(store.failures).toHaveLength(1));

    store.failures[0]!.retry();
    await vi.waitFor(() => expect(store.failures).toHaveLength(1));
  });

  it("dismiss drops the entry without resending", async () => {
    const mod = await freshRuntime();
    const writes = serve(() => json({ error: { code: "invalid_input", message: "no" } }, 400));

    mod.db.tasks.insert({ title: "x" });
    const store = mod.getSyncStore("tasks");
    await vi.waitFor(() => expect(store.failures).toHaveLength(1));

    const sent = writes();
    store.failures[0]!.dismiss();
    expect(store.failures).toHaveLength(0);
    expect(writes()).toBe(sent);
  });

  it("isPersisted distinguishes confirmed rows from optimistic ones", async () => {
    const mod = await freshRuntime();
    let releaseWrite!: (value: Response) => void;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "list") {
        return json({ rows: [{ id: "old", title: "settled" }], cursor: null, full: true });
      }
      return new Promise<Response>((resolve) => (releaseWrite = resolve));
    });

    await mod.loadModel("tasks");
    const store = mod.getSyncStore("tasks");
    expect(store.isPersisted({ id: "old", title: "settled" })).toBe(true);

    mod.db.tasks.insert({ id: "fresh", title: "optimistic" });
    expect(store.isPersisted({ id: "fresh" })).toBe(false);
    expect(store.isPersisted({ id: "old" })).toBe(true); // untouched rows unaffected

    releaseWrite(
      new Response(JSON.stringify({ id: "fresh", title: "optimistic" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await vi.waitFor(() => expect(store.isPersisted({ id: "fresh" })).toBe(true));
  });
});

describe("server action lifecycle", () => {
  const seed = (mod: Runtime, rows: unknown[]) => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "list") return json({ rows, cursor: null, full: true });
      return json({ error: { code: "invalid_input", message: "unexpected write" } }, 400);
    });
    return mod.loadModel("tasks");
  };

  it("an explicit patch shows instantly and the returned row replaces it", async () => {
    const mod = await freshRuntime();
    await seed(mod, [{ id: "t1", title: "a", status: "open" }]);

    let release!: (row: unknown) => void;
    const action = () => new Promise<unknown>((resolve) => (release = resolve));

    const handle = mod.runSyncAction("tasks", "complete", action, { id: "t1" }, { status: "done" });
    expect(visible(mod)[0]).toMatchObject({ status: "done" }); // same frame
    expect(mod.getSyncStore("tasks").isPersisted({ id: "t1" })).toBe(false);

    release({ id: "t1", title: "a", status: "done", completedAt: "2026-09-22" });
    await handle.persisted;
    expect(visible(mod)[0]).toMatchObject({ completedAt: "2026-09-22" }); // server's version won
    expect(mod.getSyncStore("tasks").isPersisted({ id: "t1" })).toBe(true);
  });

  it("derives the patch from input fields that are schema columns", async () => {
    const mod = await freshRuntime();
    await seed(mod, [{ id: "t1", title: "old", status: "open" }]);

    const action = (input: unknown) => Promise.resolve({ ...(input as object), status: "open" });
    mod.runSyncAction("tasks", "rename", action, { id: "t1", title: "new", junk: "dropped" });

    const row = visible(mod)[0]!;
    expect(row).toMatchObject({ title: "new" }); // column field applied
    expect(row).not.toHaveProperty("junk"); // non-column input never touches the row
  });

  it("without a key the action still lands through the returned row", async () => {
    const mod = await freshRuntime();
    await seed(mod, []);

    const action = () => Promise.resolve({ id: "made", title: "server-created", status: "open" });
    const handle = mod.runSyncAction("tasks", "create", action, { title: "server-created" });

    expect(visible(mod)).toHaveLength(0); // no key, no guess
    await handle.persisted;
    expect(visible(mod)).toHaveLength(1);
    expect(mod.getSyncStore("tasks").isPersisted({ id: "made" })).toBe(true);
  });

  it("a refusal rolls the patch back and lands in the failures queue under the action's name", async () => {
    const mod = await freshRuntime();
    await seed(mod, [{ id: "t1", title: "a", status: "open" }]);

    const action = () => Promise.reject(new Error("only an open task can be completed"));
    const handle = mod.runSyncAction("tasks", "complete", action, { id: "t1" }, { status: "done" });

    await expect(handle.persisted).rejects.toThrow(/only an open task/);
    expect(visible(mod)[0]).toMatchObject({ status: "open" }); // reverted
    const store = mod.getSyncStore("tasks");
    expect(store.failures).toHaveLength(1);
    expect(store.failures[0]!).toMatchObject({ operation: "complete" });
  });

  it("retry re-runs the action itself", async () => {
    const mod = await freshRuntime();
    await seed(mod, [{ id: "t1", title: "a", status: "open" }]);

    let calls = 0;
    const action = () =>
      ++calls === 1
        ? Promise.reject(new Error("no"))
        : Promise.resolve({ id: "t1", title: "a", status: "done" });

    mod.runSyncAction("tasks", "complete", action, { id: "t1" }, { status: "done" });
    const store = mod.getSyncStore("tasks");
    await vi.waitFor(() => expect(store.failures).toHaveLength(1));

    const handle = store.failures[0]!.retry() as { persisted: Promise<unknown> };
    await handle.persisted;
    expect(calls).toBe(2);
    expect(visible(mod)[0]).toMatchObject({ status: "done" });
    expect(store.failures).toHaveLength(0);
  });

  it("commits every row of an array result", async () => {
    const mod = await freshRuntime();
    await seed(mod, [
      { id: "t1", title: "a", status: "done" },
      { id: "t2", title: "b", status: "done" },
    ]);

    const action = () =>
      Promise.resolve([
        { id: "t1", title: "a", status: "archived" },
        { id: "t2", title: "b", status: "archived" },
      ]);
    await mod.runSyncAction("tasks", "archiveDone", action, {}).persisted;

    expect(visible(mod).every((row) => row.status === "archived")).toBe(true);
  });
});
