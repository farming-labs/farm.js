/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { installChunkErrorRecovery } from "../client/chunk-recovery";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ThrowingSetItemStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  getItem(): string | null {
    return null;
  }
  setItem(): void {
    throw new DOMException("quota", "QuotaExceededError");
  }
  removeItem(): void {}
}

function makeEvent(): PromiseRejectionEvent {
  const event = new Event("unhandledrejection") as PromiseRejectionEvent;
  Object.defineProperty(event, "reason", {
    value: new TypeError("Failed to fetch dynamically imported module: /a.js"),
  });
  return event;
}

const STORAGE_KEY = "farm:test-chunk-storage-unavailable";
const PAGE_LOAD_GAP_MS = 4000;

function withThrowingSessionStorage(block: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("Storage access denied", "SecurityError");
    },
  });
  try {
    block();
  } finally {
    if (saved) {
      Object.defineProperty(window, "sessionStorage", saved);
    } else {
      delete (window as { sessionStorage?: unknown }).sessionStorage;
    }
  }
}

describe("chunk recovery when storage is unavailable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reload when storage is explicitly null", () => {
    const reload = vi.fn();
    const onRecover = vi.fn();
    const cleanup = installChunkErrorRecovery({
      storage: null,
      storageKey: STORAGE_KEY,
      reload,
      onRecover,
      now: () => 1_000_000,
    });

    window.dispatchEvent(makeEvent());

    expect(reload).not.toHaveBeenCalled();
    expect(onRecover).not.toHaveBeenCalled();

    cleanup();
  });

  it("does not reload across multiple page loads when storage is null (no cross-reload loop)", () => {
    const reloads: number[] = [];
    let now = 1_000_000;

    for (let page = 0; page < 3; page++) {
      const cleanup = installChunkErrorRecovery({
        storage: null,
        storageKey: STORAGE_KEY,
        now: () => now,
        reload: () => {
          reloads.push(now);
        },
      });
      window.dispatchEvent(makeEvent());
      cleanup();
      now += PAGE_LOAD_GAP_MS;
    }

    expect(reloads).toEqual([]);
  });

  it("does not reload when setItem throws (Safari Private Mode quota error)", () => {
    const storage = new ThrowingSetItemStorage();
    const reload = vi.fn();
    const onRecover = vi.fn();
    const cleanup = installChunkErrorRecovery({
      storage,
      storageKey: STORAGE_KEY,
      reload,
      onRecover,
      now: () => 1_000_000,
    });

    window.dispatchEvent(makeEvent());

    expect(reload).not.toHaveBeenCalled();
    expect(onRecover).not.toHaveBeenCalled();

    cleanup();
  });

  it("does not reload when default window.sessionStorage access throws", () => {
    const reload = vi.fn();
    const onRecover = vi.fn();

    withThrowingSessionStorage(() => {
      const cleanup = installChunkErrorRecovery({
        storageKey: STORAGE_KEY,
        reload,
        onRecover,
        now: () => 1_000_000,
      });

      window.dispatchEvent(makeEvent());

      expect(reload).not.toHaveBeenCalled();
      expect(onRecover).not.toHaveBeenCalled();

      cleanup();
    });
  });

  it("still reloads once per guard window when storage works (no regression to working path)", () => {
    const storage = new MemoryStorage();
    const reloads: number[] = [];
    let now = 1_000_000;

    let cleanup = installChunkErrorRecovery({
      storage,
      storageKey: STORAGE_KEY,
      now: () => now,
      reload: () => {
        reloads.push(now);
      },
    });
    window.dispatchEvent(makeEvent());
    cleanup();

    now += PAGE_LOAD_GAP_MS;
    cleanup = installChunkErrorRecovery({
      storage,
      storageKey: STORAGE_KEY,
      now: () => now,
      reload: () => {
        reloads.push(now);
      },
    });
    window.dispatchEvent(makeEvent());
    cleanup();

    expect(reloads).toEqual([1_000_000]);
    expect(storage.getItem(STORAGE_KEY)).toBe("1000000");
  });
});
