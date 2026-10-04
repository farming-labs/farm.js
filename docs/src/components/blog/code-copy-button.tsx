"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "error";

const LABELS: Record<CopyState, string> = { idle: "COPY", copied: "COPIED", error: "RETRY" };
const STATUS: Record<CopyState, string> = {
  idle: "",
  copied: "Code copied to clipboard.",
  error: "Could not copy. Try again or select and copy the code manually.",
};

/** The copy chip on a blog code block. The server highlights the code; this only copies it. */
export function BlogCodeCopy({ text, label }: { text: string; label: string }) {
  // Hidden until hydrated: without JavaScript the button could not copy anything.
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<CopyState>("idle");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setReady(true);
    return () => clearTimeout(timer.current);
  }, []);

  async function copy() {
    clearTimeout(timer.current);
    setBusy(true);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
      timer.current = setTimeout(() => setState("idle"), 1800);
    }
  }

  return (
    <>
      <button
        type="button"
        className="blog-code-copy"
        data-state={state === "idle" ? undefined : state}
        aria-label={state === "idle" ? `Copy ${label} code` : `${LABELS[state]} code`}
        title={`Copy ${label} code`}
        hidden={!ready}
        disabled={busy}
        onClick={copy}
      >
        <Copy className="blog-copy-icon" size={14} strokeWidth={1.8} aria-hidden />
        <Check className="blog-copy-check" size={14} strokeWidth={1.8} aria-hidden />
        <span data-copy-label>{LABELS[state]}</span>
      </button>
      <span className="sr-only" role="status" data-copy-status>
        {STATUS[state]}
      </span>
    </>
  );
}
