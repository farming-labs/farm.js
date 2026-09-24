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

  it("fires the after-write hook per write, including validation failures", async () => {
    const afterWrite = vi.fn(async () => {});
    setContentAfterWrite(afterWrite);
    const posts = runtimeWith(writableSource()).posts!;

    await posts.create({ data: { title: "a" } });
    await posts.delete("a");
    expect(afterWrite).toHaveBeenCalledTimes(2);

    // The CMS accepted this write even though it fails the collection schema:
    // the caller must see the rejection AND the snapshot must still refresh,
    // so readers see the CMS's real state rather than a stale one.
    const failing = runtimeWith(
      writableSource({ create: async () => ({ id: "bad", data: {} }) }),
    ).posts!;
    await expect(failing.create({ data: {} })).rejects.toThrow();
    expect(afterWrite).toHaveBeenCalledTimes(3);
  });

  it("does not fail the caller when the after-write refresh throws", async () => {
    setContentAfterWrite(async () => {
      throw new Error("rebuild exploded");
    });
    const posts = runtimeWith(writableSource()).posts!;
    await expect(posts.create({ data: { title: "a" } })).resolves.toMatchObject({ id: "new" });
  });

  it("scopes after-write disposal to its own registration across a restart", () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const disposeFirst = setContentAfterWrite(first);
    // Vite restart: the NEW server registers before the OLD server closes.
    setContentAfterWrite(second);
    disposeFirst(); // the old server's close handler
    const runtime = (globalThis as Record<string, any>)["__FARM_CONTENT_WRITE_RUNTIME__"];
    expect(runtime.afterWrite).toBe(second);
  });

  it("unregisters only its own collection registrations", () => {
    const unregister = registerContentWriteRuntime({ posts: { schema } });
    registerContentWriteRuntime({ posts: { schema } }); // replacement registration
    unregister(); // stale disposer must not remove the replacement
    const runtime = (globalThis as Record<string, any>)["__FARM_CONTENT_WRITE_RUNTIME__"];
    expect(runtime.registrations.posts).toBeDefined();
  });

  it("rejects reserved registration names and keeps the registry prototype clean", () => {
    expect(() => registerContentWriteRuntime({ ["__proto__"]: { schema } } as never)).toThrow(
      /reserved/,
    );
    const runtime = (globalThis as Record<string, any>)["__FARM_CONTENT_WRITE_RUNTIME__"];
    expect(Object.getPrototypeOf(runtime.registrations)).toBe(null);
  });

  it("answers protocol probes with undefined instead of throwing", async () => {
    const handles = runtimeWith(writableSource());
    await expect(Promise.resolve(handles)).resolves.toBe(handles); // `then` probe
    expect(() => JSON.stringify(handles)).not.toThrow(); // `toJSON` probe
    expect(() => (handles as Record<string, any>).missing!.all()).toThrow(/Unknown collection/);
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
