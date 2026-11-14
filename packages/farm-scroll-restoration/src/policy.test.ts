import { describe, expect, it } from "vitest";
import {
  isValidScrollPosition,
  parseStoredScrollPosition,
  readStoredScrollPosition,
  scrollKeyFor,
  scrollStorageKey,
  writeStoredScrollPosition,
  type ScrollStorage,
} from "./policy.js";

function memoryStorage(initial: Record<string, string> = {}): ScrollStorage & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

describe("scrollKeyFor", () => {
  it("keys by pathname plus query string", () => {
    expect(scrollKeyFor({ pathname: "/search", search: "?q=a" })).toBe("/search?q=a");
    expect(scrollKeyFor({ pathname: "/search", search: "?q=b" })).toBe("/search?q=b");
  });

  it("keys by pathname alone without a query string", () => {
    expect(scrollKeyFor({ pathname: "/posts/7", search: "" })).toBe("/posts/7");
    expect(scrollKeyFor({ pathname: "/posts/7" })).toBe("/posts/7");
  });

  it("leaves the hash out of the key", () => {
    const location = { pathname: "/posts/7", search: "", hash: "#top" };
    expect(scrollKeyFor(location)).toBe("/posts/7");
  });
});

describe("scrollStorageKey", () => {
  it("namespaces keys away from core's farm-scroll-* entries", () => {
    expect(scrollStorageKey("farm-scroll-restore", "/posts/[id]")).toBe(
      "farm-scroll-restore:/posts/[id]",
    );
  });
});

describe("isValidScrollPosition", () => {
  it("accepts finite non-negative x/y pairs", () => {
    expect(isValidScrollPosition({ x: 0, y: 120 })).toBe(true);
    expect(isValidScrollPosition({ x: 10.5, y: 0 })).toBe(true);
  });

  it("rejects missing, non-numeric, negative, or infinite values", () => {
    expect(isValidScrollPosition(null)).toBe(false);
    expect(isValidScrollPosition("120")).toBe(false);
    expect(isValidScrollPosition({ x: 0 })).toBe(false);
    expect(isValidScrollPosition({ x: 0, y: -1 })).toBe(false);
    expect(isValidScrollPosition({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isValidScrollPosition({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidScrollPosition({ x: 0, y: 10, extra: true })).toBe(true);
  });
});

describe("parseStoredScrollPosition", () => {
  it("parses a stored position", () => {
    expect(parseStoredScrollPosition('{"x":0,"y":250}')).toEqual({ x: 0, y: 250 });
  });

  it("reads malformed or invalid entries as nothing saved", () => {
    expect(parseStoredScrollPosition(null)).toBeUndefined();
    expect(parseStoredScrollPosition("not json")).toBeUndefined();
    expect(parseStoredScrollPosition('{"x":0}')).toBeUndefined();
    expect(parseStoredScrollPosition('{"x":0,"y":-5}')).toBeUndefined();
  });
});

describe("read/write stored scroll position", () => {
  it("round-trips through a storage", () => {
    const storage = memoryStorage();
    writeStoredScrollPosition(storage, "farm-scroll-restore:/a", { x: 0, y: 90 });
    expect(readStoredScrollPosition(storage, "farm-scroll-restore:/a")).toEqual({ x: 0, y: 90 });
    expect(readStoredScrollPosition(storage, "farm-scroll-restore:/missing")).toBeUndefined();
  });

  it("never throws on a hostile storage", () => {
    const throwing: ScrollStorage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    expect(() => writeStoredScrollPosition(throwing, "k", { x: 0, y: 1 })).not.toThrow();
    expect(readStoredScrollPosition(throwing, "k")).toBeUndefined();
    expect(readStoredScrollPosition(null, "k")).toBeUndefined();
    expect(() => writeStoredScrollPosition(undefined, "k", { x: 0, y: 1 })).not.toThrow();
  });
});
