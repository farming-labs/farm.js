// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A client that already synced asks only for rows changed since its cursor. A
 * delta cannot carry a deletion, so the server also lists every key the client
 * may still see, and the client drops the rest. These cover that pruning, what
 * it must leave alone, and deletes whose row is already gone.
 */

const config = {
  path: "/_farm/sync",
  models: {
    tasks: {
      key: "id",
      access: "write" as const,
      persist: false,
      cursor: "updatedAt",
      fields: ["id", "title", "updatedAt"],
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

const AT = "2026-10-01T00:00:00.000Z";
const ids = (mod: Runtime) =>
  mod
    .getSyncStore("tasks")
    .getRows()
    .map((row) => row.id);

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

type Handler = (body: any) => Promise<Response>;

/** First list is a full snapshot of `initial`; later calls go to `next`. */
function serve(initial: string[], next: Handler) {
  let listed = false;
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.operation === "list" && !listed) {
      listed = true;
      return json({
        rows: initial.map((id) => ({ id, title: id, updatedAt: AT })),
        cursor: AT,
        full: true,
      });
    }
    return next(body);
  });
}

async function loaded(mod: Runtime) {
  mod.getSyncStore("tasks");
  await vi.waitFor(() => expect(mod.getSyncStore("tasks").status).toBe("ready"));
}

describe("incremental sync removes rows the server no longer lists", () => {
  it("drops a row deleted on the server from a client that already synced", async () => {
    const mod = await freshRuntime();
    serve(["1", "2"], () => json({ rows: [], cursor: AT, full: false, keys: ["1"] }));
    await loaded(mod);
    expect(ids(mod)).toEqual(["1", "2"]);

    await mod.db.tasks.refresh();

    expect(ids(mod)).toEqual(["1"]);
    expect(fetchMock.mock.calls.at(-1)![1].body).toContain(`"since":"${AT}"`);
  });

  it("keeps every row when an older server sends a delta without keys", async () => {
    const mod = await freshRuntime();
    serve(["1", "2"], () => json({ rows: [], cursor: AT, full: false }));
    await loaded(mod);

    await mod.db.tasks.refresh();

    expect(ids(mod)).toEqual(["1", "2"]);
  });

  it("does not prune an optimistic insert the server has not confirmed yet", async () => {
    const mod = await freshRuntime();
    let confirm!: () => void;
    serve(["1"], (body) => {
      if (body.operation === "list")
        return json({ rows: [], cursor: AT, full: false, keys: ["1"] });
      return new Promise<Response>((resolve) => {
        confirm = () => void json({ ...body.input, updatedAt: AT }).then(resolve);
      });
    });
    await loaded(mod);

    const handle = mod.db.tasks.insert({ id: "new", title: "pending" });
    await mod.db.tasks.refresh();
    expect(ids(mod)).toEqual(["1", "new"]);

    confirm();
    await handle.persisted;
    expect(ids(mod)).toEqual(["1", "new"]);
  });

  it("keeps a row confirmed while the list that omits it was in flight", async () => {
    const mod = await freshRuntime();
    let answerList!: () => void;
    serve(["1"], (body) => {
      if (body.operation === "list") {
        // The server read its keys before the insert below committed.
        return new Promise<Response>((resolve) => {
          answerList = () =>
            void json({ rows: [], cursor: AT, full: false, keys: ["1"] }).then(resolve);
        });
      }
      return json({ ...body.input, updatedAt: AT });
    });
    await loaded(mod);

    const refreshing = mod.db.tasks.refresh();
    await mod.db.tasks.insert({ id: "new", title: "raced" }).persisted;
    answerList();
    await refreshing;

    expect(ids(mod)).toEqual(["1", "new"]);
  });
});

describe("deleting a row that is already gone", () => {
  it("keeps a retried delete deleted when its first attempt landed", async () => {
    const mod = await freshRuntime();
    let deletes = 0;
    serve(["1", "2"], () => {
      deletes += 1;
      // The first attempt deleted the row but the response never arrived, so
      // the retry finds nothing to delete.
      if (deletes === 1) return Promise.reject(new TypeError("Failed to fetch"));
      return json({ error: { code: "not_found", message: "No tasks row matched 1" } }, 404);
    });
    await loaded(mod);

    const handle = mod.db.tasks.delete({ id: "1" });
    await expect(handle.persisted).resolves.toBeDefined();

    expect(deletes).toBe(2);
    expect(handle.state).toBe("completed");
    expect(ids(mod)).toEqual(["2"]);
    expect(mod.getSyncStore("tasks").failures).toHaveLength(0);
  });

  it("still rolls a delete back when the server refuses it for another reason", async () => {
    const mod = await freshRuntime();
    serve(["1"], () => json({ error: { code: "not_exposed", message: "hidden" } }, 404));
    await loaded(mod);

    await expect(mod.db.tasks.delete({ id: "1" }).persisted).rejects.toThrow(/hidden/);

    expect(ids(mod)).toEqual(["1"]);
    expect(mod.getSyncStore("tasks").failures).toHaveLength(1);
  });
});
