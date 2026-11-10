// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncRuntimeConfig } from "./store";

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

async function freshRuntime(runtimeConfig: SyncRuntimeConfig = config): Promise<Runtime> {
  vi.resetModules();
  const mod = await import("./client");
  mod.startSyncRuntime(runtimeConfig, { retry: { count: 0, delay: 1 } });
  return mod;
}

const rowsFor: Record<string, Array<{ id: string; title: string; updatedAt: string }>> = {
  alice: [{ id: "a1", title: "alice's task", updatedAt: "2026-09-29T10:00:00.000Z" }],
  bob: [{ id: "b1", title: "bob's task", updatedAt: "2026-09-29T09:00:00.000Z" }],
};

let session = "alice";
let fetchMock: ReturnType<typeof vi.fn>;
const listRequests: Array<{ session: string; since: unknown; scope?: unknown }> = [];

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A server that scopes rows to the current session, reports the scope's
 * fingerprint, and honors `since` only when it was kept under that scope.
 */
function serverFor(currentSession: string, since: unknown, clientScope?: unknown) {
  const rows = rowsFor[currentSession]!;
  const scope = `scope-${currentSession}`;
  if (typeof since === "string" && (clientScope == null || clientScope === scope)) {
    return respond({
      rows: rows.filter((row) => row.updatedAt > since),
      cursor: since,
      full: false,
      scope,
    });
  }
  return respond({ rows, cursor: rows.at(-1)?.updatedAt ?? null, full: true, scope });
}

beforeEach(() => {
  session = "alice";
  listRequests.length = 0;
  localStorage.clear();
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.operation === "list") {
      listRequests.push({ session, since: body.since, scope: body.scope });
      return serverFor(session, body.since, body.scope);
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
    expect(listRequests.at(-1)).toMatchObject({ session: "bob", since: null });
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

describe("sync across a reload", () => {
  const offline = () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
  };

  async function syncAsAlice() {
    const mod = await freshRuntime();
    await mod.loadModel("tasks");
    expect(titles(mod)).toEqual(["alice's task"]);
  }

  it("never paints the previous account's saved rows, even offline", async () => {
    await syncAsAlice();

    // Alice signs out and the page reloads; bob opens the app offline.
    session = "bob";
    offline();
    const mod = await freshRuntime();
    mod.hydrateModel("tasks");
    await vi.waitFor(() => expect(mod.getSyncStore("tasks").status).toBe("error"));
    expect(titles(mod)).toEqual([]);
  });

  it("replaces the previous account's saved rows once the server answers", async () => {
    await syncAsAlice();

    session = "bob";
    const mod = await freshRuntime();
    mod.hydrateModel("tasks");
    expect(titles(mod)).toEqual([]);
    await vi.waitFor(() => expect(titles(mod)).toEqual(["bob's task"]));
    // Alice's cursor went along with her scope, and the server ignored both.
    expect(listRequests.at(-1)).toMatchObject({ session: "bob", scope: "scope-alice" });
    const persisted = Object.keys(localStorage)
      .filter((key) => key.startsWith("farm-sync:"))
      .map((key) => localStorage.getItem(key) ?? "");
    expect(persisted.join("")).not.toContain("alice");
  });

  it("reuses saved rows for the same account through an incremental list", async () => {
    await syncAsAlice();

    const mod = await freshRuntime();
    mod.hydrateModel("tasks");
    await vi.waitFor(() => expect(titles(mod)).toEqual(["alice's task"]));
    expect(listRequests.at(-1)).toEqual({
      session: "alice",
      since: "2026-09-29T10:00:00.000Z",
      scope: "scope-alice",
    });
  });

  it("paints a public model's saved rows before the server answers", async () => {
    const publicConfig = {
      ...config,
      models: { tasks: { ...config.models.tasks, scope: "public" } },
    };
    localStorage.setItem(
      "farm-sync:1:tasks",
      JSON.stringify({ rows: rowsFor.alice, cursor: null, scope: "public" }),
    );
    offline();
    const mod = await freshRuntime(publicConfig);
    mod.hydrateModel("tasks");
    expect(titles(mod)).toEqual(["alice's task"]);
  });
});
