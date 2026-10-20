"use client";

import { useEffect } from "react";

/**
 * Wires every `[data-agent-check-copy]` button in a report to the clipboard: one island for any
 * number of snippets, since saved reports are async pages whose hydration Farm keeps to a few
 * isolated boundaries. The buttons render hidden and appear here, once copying can work.
 */
export function AgentCheckClipboard() {
  useEffect(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>("[data-agent-check-copy]");
    for (const button of buttons) button.hidden = false;
    const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
    const copy = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
        "[data-agent-check-copy]",
      );
      if (!button) return;
      navigator.clipboard.writeText(button.dataset.agentCheckCopy ?? "").then(
        () => {
          button.dataset.copied = "";
          button.setAttribute("aria-label", "Copied");
          clearTimeout(timers.get(button));
          timers.set(
            button,
            setTimeout(() => {
              delete button.dataset.copied;
              button.setAttribute("aria-label", "Copy the snippet");
            }, 2000),
          );
        },
        () => {
          // No clipboard access (permissions, an insecure origin): select the code instead,
          // so a keyboard copy takes it.
          const code = button.closest(".agent-check-snippet")?.querySelector("pre");
          const selection = window.getSelection();
          if (!code || !selection) return;
          const range = document.createRange();
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
        },
      );
    };
    document.addEventListener("click", copy);
    return () => {
      document.removeEventListener("click", copy);
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  return null;
}
