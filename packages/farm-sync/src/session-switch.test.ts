// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server scopes every read to the session, but the browser keeps rows and
 * an incremental cursor in memory. A sign-out and sign-in (or an org switch)
 * without a page reload has to drop both, or the next account keeps seeing the
 * previous one's rows and asks only for changes since the previous cursor.
 */

const config = {
  path: "/_farm/sync",
  models: {
    tasks: {
      key: "id",
      access: "write" as const,
      persist: true,
      cursor: "updatedAt",
      fields: ["id", "title", "updatedAt"],
    },
  },
};

type Runtime = typeof import("./client");

async function freshRuntime(): Promise<Runtime> {
  vi.resetModules();
  const mod = await import("./client");
  mod.startSyncRuntime(config, { retry: { count: 0, delay: 1 } });
  return mod;
}

const rowsFor: Record<string, Array<{ id: string; title: string; updatedAt: string }>> = {
  alice: [{ id: "a1", title: "alice's task", updatedAt: "2026-09-29T10:00:00.000Z" }],
  bob: [{ id: "b1", title: "bob's task", updatedAt: "2026-09-29T09:00:00.000Z" }],
};

let session = "alice";
let fetchMock: ReturnType<typeof vi.fn>;
const listRequests: Array<{ session: string; since: unknown }> = [];

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A server that scopes rows to the current session and honors `since`. */
function serverFor(currentSession: string, since: unknown) {
  const rows = rowsFor[currentSession]!;
  if (typeof since === "string") {
    return respond({
      rows: rows.filter((row) => row.updatedAt > since),
      cursor: since,
      full: false,
    });
  }
  return respond({ rows, cursor: rows.at(-1)?.updatedAt ?? null, full: true });
}

beforeEach(() => {
  session = "alice";
  listRequests.length = 0;
  localStorage.clear();
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.operation === "list") {
      listRequests.push({ session, since: body.since });
      return serverFor(session, body.since);
    }
    return respond({ ...body.input, updatedAt: "2026-09-29T11:00:00.000Z" });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const titles = (mod: Runtime) =>
  mod
    .getSyncStore("tasks")
    .getRows()
    .map((row) => row.title);

describe("sync across a session change", () => {
  it("shows the next account only its own rows after clearSyncedRows()", async () => {
    const mod = await freshRuntime();
    await mod.loadModel("tasks");
    expect(titles(mod)).toEqual(["alice's task"]);

    session = "bob";
    mod.clearSyncedRows();
    expect(titles(mod)).toEqual([]);

    // The next use reloads in full, under bob's session.
    mod.getSyncStore("tasks");
    await vi.waitFor(() => expect(titles(mod)).toEqual(["bob's task"]));
    expect(listRequests.at(-1)).toEqual({ session: "bob", since: null });
    // What bob's session persisted holds none of alice's rows.
    const persisted = Object.keys(localStorage)
      .filter((key) => key.startsWith("farm-sync:"))
      .map((key) => localStorage.getItem(key) ?? "");
    expect(persisted.join("")).toContain("bob's task");
    expect(persisted.join("")).not.toContain("alice");
  });

  it("drops a load that was in flight when the session changed", async () => {
    const mod = await freshRuntime();
    let releaseAlice!: () => void;
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      await new Promise<void>((resolve) => (releaseAlice = resolve));
      return serverFor("alice", body.since);
    });

    const aliceLoad = mod.loadModel("tasks");
    await vi.waitFor(() => expect(releaseAlice).toBeTypeOf("function"));
    session = "bob";
    mod.clearSyncedRows();
    releaseAlice();
    await aliceLoad;

    expect(titles(mod)).not.toContain("alice's task");
  });

  it("does not fold a write that finishes after the session changed", async () => {
    const mod = await freshRuntime();
    await mod.loadModel("tasks");

    let releaseWrite!: () => void;
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      await new Promise<void>((resolve) => (releaseWrite = resolve));
      return respond({ ...body.input, updatedAt: "2026-09-29T11:00:00.000Z" });
    });
    const write = mod.db.tasks.insert({ id: "a2", title: "alice's draft" });
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf("function"));

    session = "bob";
    mod.clearSyncedRows();
    releaseWrite();
    await write;

    expect(titles(mod)).not.toContain("alice's draft");
  });
});
