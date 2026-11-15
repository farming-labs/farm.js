import type { WebSocket } from "ws";

// The close handshake normally completes within one round trip. Without a
// bound, an unresponsive peer holds shutdown open for ws's 30s close timeout.
const CLOSE_HANDSHAKE_GRACE_MS = 1_000;

export function closeWebSocket(socket: WebSocket, code: number, reason: string) {
  if (socket.readyState === socket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => socket.terminate(), CLOSE_HANDSHAKE_GRACE_MS);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.close(code, reason);
  });
}
