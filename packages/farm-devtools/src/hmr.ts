type UpdateState = "pending" | "ready" | "error" | "disconnected";
interface HotContext {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
  dispose?(listener: () => void): void;
}

/** Reuse the app's Vite connection. No polling, second socket, or source payloads. */
export function startDevtoolsUpdates(
  runtimeWindow: Window = window,
  hot = (import.meta as ImportMeta & { hot?: HotContext }).hot,
): { dispose(): void } {
  const send = (state: UpdateState) => {
    runtimeWindow.document
      .querySelector<HTMLIFrameElement>("#__farm_devtools_overlay__ > iframe")
      ?.contentWindow?.postMessage(
        { type: "farm:devtools:hmr", state },
        runtimeWindow.location.origin,
      );
  };
  const listeners: [string, () => void][] = [
    ["vite:beforeUpdate", () => send("pending")],
    ["vite:afterUpdate", () => send("ready")],
    ["vite:beforeFullReload", () => send("pending")],
    ["vite:error", () => send("error")],
    ["vite:ws:disconnect", () => send("disconnected")],
    ["vite:ws:connect", () => send("ready")],
  ];
  for (const [event, listener] of listeners) hot?.on(event, listener);
  const dispose = () => {
    for (const [event, listener] of listeners) hot?.off(event, listener);
  };
  hot?.dispose?.(dispose);
  return { dispose };
}
