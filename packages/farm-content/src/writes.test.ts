import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContentRuntime,
  registerContentWriteRuntime,
  setContentAfterWrite,
} from "./runtime.js";
import type { ContentRemoteSource } from "./types.js";

const KEY = "__FARM_CONTENT_WRITE_RUNTIME__";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[KEY];
});

const schema = {
  parse(value: unknown) {
    const data = value as { title?: unknown };
    if (typeof data?.title !== "string") throw new Error("title must be a string");
    return data;
  },
};

function writableSource(overrides: Partial<ContentRemoteSource> = {}): ContentRemoteSource {
  return {
    kind: "remote",
    name: "cms:posts",
    fetch: async () => [],
    create: vi.fn(async (input) => ({ id: "new", data: input.data })),
    update: vi.fn(async (id, patch) => ({ id, data: { title: "ok", ...patch.data } })),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

const runtimeWith = (source?: ContentRemoteSource) => {
  registerContentWriteRuntime({ posts: { ...(source ? { source } : {}), schema } });
  return createContentRuntime({ posts: [] }).collections as Record<
    string,
    {
      create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
      update(id: string, patch: { data?: Record<string, unknown> }): Promise<{ id: string }>;
      delete(id: string): Promise<void>;
      all(): Promise<readonly unknown[]>;
    }
  >;
};

describe("collection write surface", () => {
  it("routes create, update, and delete through the source callbacks", async () => {
    const source = writableSource();
    const posts = runtimeWith(source).posts!;

    await posts.create({ data: { title: "a" } });
    await posts.update("new", { data: { title: "b" } });
    await posts.delete("new");

    expect(source.create).toHaveBeenCalledWith({ data: { title: "a" } });
    expect(source.update).toHaveBeenCalledWith("new", { data: { title: "b" } });
    expect(source.delete).toHaveBeenCalledWith("new");
  });

  it("validates what the source stored against the collection schema", async () => {
    const source = writableSource({
      update: async (id) => ({ id, data: { title: 42 } }), // the CMS drifted
    });
    const posts = runtimeWith(source).posts!;
    await expect(posts.update("x", {})).rejects.toThrow(/title must be a string/);
  });

  it("fires the after-write hook once per successful write, not on failure", async () => {
    const afterWrite = vi.fn(async () => {});
    setContentAfterWrite(afterWrite);
    const posts = runtimeWith(writableSource()).posts!;

    await posts.create({ data: { title: "a" } });
    await posts.delete("a");
    expect(afterWrite).toHaveBeenCalledTimes(2);

    const failing = runtimeWith(
      writableSource({ create: async () => ({ id: "bad", data: {} }) }),
    ).posts!;
    await expect(failing.create({ data: {} })).rejects.toThrow();
    expect(afterWrite).toHaveBeenCalledTimes(2); // unchanged
  });

  it("explains read-only collections and missing verbs", async () => {
    const readOnly = runtimeWith(undefined).posts!; // files-backed: no source registered
    await expect(readOnly.create({ data: {} })).rejects.toThrow(/read-only.*edited on disk/s);

    const noDelete = runtimeWith(writableSource({ delete: undefined })).posts!;
    await expect(noDelete.delete("x")).rejects.toThrow(/does not implement delete\(\)/);
  });

  it("reads still come from the snapshot and unknown collections still fail", async () => {
    const handles = runtimeWith(writableSource());
    await expect(handles.posts!.all()).resolves.toEqual([]);
    expect(() => handles.missing!.all()).toThrow(/Unknown collection "missing"/);
  });
});
