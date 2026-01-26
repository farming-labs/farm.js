/**
 * Cross-hook synchronization system for query state
 * Inspired by nuqs implementation
 */

type Listener = (searchParams: URLSearchParams) => void;
type KeyListener = (payload: { state: any; query: string | null }) => void;

class Emitter {
  private listeners: Map<string, Set<Listener>> = new Map();
  private keyListeners: Map<string, Set<KeyListener>> = new Map();

  /**
   * Emit a global update event (all hooks should sync)
   */
  emitUpdate(searchParams: URLSearchParams): void {
    const listeners = this.listeners.get("update") || new Set();
    listeners.forEach((listener) => listener(searchParams));
  }

  /**
   * Emit a key-specific update (for cross-hook sync)
   */
  emitKey(key: string, payload: { state: any; query: string | null }): void {
    const listeners = this.keyListeners.get(key) || new Set();
    listeners.forEach((listener) => listener(payload));
  }

  /**
   * Subscribe to global updates
   */
  on(event: "update", listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Subscribe to key-specific updates
   */
  onKey(key: string, listener: KeyListener): void {
    if (!this.keyListeners.has(key)) {
      this.keyListeners.set(key, new Set());
    }
    this.keyListeners.get(key)!.add(listener);
  }

  /**
   * Unsubscribe from global updates
   */
  off(event: "update", listener: Listener): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Unsubscribe from key-specific updates
   */
  offKey(key: string, listener: KeyListener): void {
    const listeners = this.keyListeners.get(key);
    if (listeners) {
      listeners.delete(listener);
    }
  }
}

export const emitter = new Emitter();
