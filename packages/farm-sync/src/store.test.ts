import { describe, expect, it, vi } from "vitest";
import { SyncModelStore } from "./store";

const descriptor = { key: "id", access: "write" as const, persist: true, cursor: "updatedAt" };

function store() {
  return new SyncModelStore("tasks", descriptor);
}

describe("SyncModelStore", () => {
  it("shows optimistic rows before the server confirms them", () => {
    const s = store();
    s.applyServerRows([{ id: "1", title: "existing" }], { full: true, cursor: null });

    const layer = { type: "upsert" as const, key: "2", row: { id: "2", title: "optimistic" } };
    s.addLayer(layer);

    expect(s.getRows().map((r) => r.title)).toEqual(["existing", "optimistic"]);
  });

  it("rolls back by removing the layer, restoring the prior row exactly", () => {
    const s = store();
    s.applyServerRows([{ id: "1", title: "original" }], { full: true, cursor: null });

    const layer = { type: "upsert" as const, key: "1", row: { id: "1", title: "guess" } };
    s.addLayer(layer);
    expect(s.get("1")!.title).toBe("guess");

    s.removeLayer(layer);
    expect(s.get("1")!.title).toBe("original");
  });

  it("commits a layer using the server's row", () => {
    const s = store();
    const layer = { type: "upsert" as const, key: "1", row: { id: "1", title: "guess" } };
    s.addLayer(layer);

    s.commitLayer(layer, { id: "1", title: "canonical", updatedAt: "2026-01-01" });

    expect(s.get("1")).toEqual({ id: "1", title: "canonical", updatedAt: "2026-01-01" });
    expect(s.confirmedRows()).toHaveLength(1);
  });

  it("applies a delete layer and commits it", () => {
    const s = store();
    s.applyServerRows([{ id: "1" }, { id: "2" }], { full: true, cursor: null });

    const layer = { type: "delete" as const, key: "1" };
    s.addLayer(layer);
    expect(s.getRows().map((r) => r.id)).toEqual(["2"]);

    s.commitLayer(layer, null);
    expect(s.confirmedRows().map((r) => r.id)).toEqual(["2"]);
  });

  it("notifies subscribers on every visible change", () => {
    const s = store();
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);

    s.applyServerRows([{ id: "1" }], { full: true, cursor: null });
    const layer = { type: "upsert" as const, key: "2", row: { id: "2" } };
    s.addLayer(layer);
    s.removeLayer(layer);

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    s.applyServerRows([{ id: "3" }], { full: true, cursor: null });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps a stable array identity until rows change", () => {
    const s = store();
    s.applyServerRows([{ id: "1" }], { full: true, cursor: null });

    const first = s.getRows();
    expect(s.getRows()).toBe(first);

    s.addLayer({ type: "upsert", key: "2", row: { id: "2" } });
    expect(s.getRows()).not.toBe(first);
  });

  it("merges a delta without dropping rows the server did not resend", () => {
    const s = store();
    s.applyServerRows([{ id: "1", title: "a" }], { full: true, cursor: "2026-01-01" });
    s.applyServerRows([{ id: "2", title: "b" }], { full: false, cursor: "2026-02-01" });

    expect(s.getRows().map((r) => r.id).sort()).toEqual(["1", "2"]);
    expect(s.cursor).toBe("2026-02-01");
  });

  it("replaces everything on a full snapshot", () => {
    const s = store();
    s.applyServerRows([{ id: "1" }, { id: "2" }], { full: true, cursor: null });
    s.applyServerRows([{ id: "3" }], { full: true, cursor: null });

    expect(s.getRows().map((r) => r.id)).toEqual(["3"]);
  });

  it("hydrates from disk but never over live rows", () => {
    const warm = store();
    warm.hydrate([{ id: "1", title: "from disk" }], "2026-01-01");
    expect(warm.get("1")!.title).toBe("from disk");
    expect(warm.status).toBe("ready");

    const live = store();
    live.applyServerRows([{ id: "1", title: "from server" }], { full: true, cursor: null });
    live.hydrate([{ id: "1", title: "from disk" }], null);
    expect(live.get("1")!.title).toBe("from server");
  });

  it("persists confirmed rows only, never optimistic guesses", () => {
    const s = store();
    s.applyServerRows([{ id: "1", title: "confirmed" }], { full: true, cursor: null });
    s.addLayer({ type: "upsert", key: "2", row: { id: "2", title: "guess" } });

    expect(s.confirmedRows().map((r) => r.title)).toEqual(["confirmed"]);
  });

  it("tracks pending and paused counts without going negative", () => {
    const s = store();
    s.trackPending(1);
    s.trackPending(1);
    s.trackPending(-1);
    expect(s.pending).toBe(1);

    s.trackPaused(-5);
    expect(s.paused).toBe(0);
  });

  it("layers stack so the newest write wins visually", () => {
    const s = store();
    s.applyServerRows([{ id: "1", title: "server" }], { full: true, cursor: null });
    s.addLayer({ type: "upsert", key: "1", row: { id: "1", title: "first" } });
    s.addLayer({ type: "upsert", key: "1", row: { id: "1", title: "second" } });

    expect(s.get("1")!.title).toBe("second");
  });
});
