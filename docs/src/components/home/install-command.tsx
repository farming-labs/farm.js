"use client";

import { Check, Copy, LoaderCircle, RefreshCw, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const commands = [
  { label: "npm", command: "npm create farm@latest" },
  { label: "Yarn", command: "yarn create farm" },
  { label: "pnpm", command: "pnpm create farm@latest" },
  { label: "Bun", command: "bun create farm" },
] as const;

export function InstallCommand() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  const activeCommand = commands[activeIndex];
  const copyLabel =
    copyState === "copying"
      ? "Copying"
      : copyState === "copied"
        ? "Copied"
        : copyState === "failed"
          ? "Retry"
          : "Copy";
  const CopyStateIcon =
    copyState === "copying"
      ? LoaderCircle
      : copyState === "copied"
        ? Check
        : copyState === "failed"
          ? RefreshCw
          : Copy;

  useEffect(() => {
    return () => window.clearTimeout(resetTimer.current);
  }, []);

  async function copyCommand() {
    let didCopy = false;
    let clipboardTimer: number | undefined;
    setCopyState("copying");

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");

      await Promise.race([
        navigator.clipboard.writeText(activeCommand.command),
        new Promise<never>((_, reject) => {
          clipboardTimer = window.setTimeout(
            () => reject(new Error("Clipboard permission timed out")),
            600,
          );
        }),
      ]);
      didCopy = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = activeCommand.command;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      didCopy = document.execCommand("copy");
      textarea.remove();
    } finally {
      window.clearTimeout(clipboardTimer);
    }

    window.clearTimeout(resetTimer.current);
    setCopyState(didCopy ? "copied" : "failed");
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1600);
  }

  return (
    <div className="overflow-hidden border border-white/12 bg-black shadow-[0_18px_60px_rgba(0,0,0,0.4)]">
      <div
        aria-label="Package manager"
        className="flex min-w-0 items-center overflow-x-auto border-b border-white/10"
        role="group"
      >
        {commands.map((item, index) => (
          <button
            key={item.label}
            aria-pressed={activeIndex === index}
            className="relative h-11 shrink-0 border-r border-white/8 px-4 font-mono text-xs tracking-normal text-white/42 transition-colors duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white aria-pressed:bg-white/[0.05] aria-pressed:text-white"
            onClick={() => {
              setActiveIndex(index);
              setCopyState("idle");
            }}
            type="button"
          >
            {item.label}
            {activeIndex === index ? (
              <span className="absolute inset-x-3 bottom-0 h-px bg-white" />
            ) : null}
          </button>
        ))}
        <span className="ml-auto hidden shrink-0 items-center gap-1.5 px-4 font-mono text-[10px] uppercase tracking-normal text-white/30 sm:flex">
          <Terminal aria-hidden className="size-3" strokeWidth={1.5} />
          bash
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2.5 px-4 py-4 font-mono text-[13px] tracking-normal">
        <span aria-hidden className="shrink-0 text-white/62">
          $
        </span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-white/78">
          {activeCommand.command}
        </code>
        <button
          aria-label={`${copyLabel} install command`}
          className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 border border-white/12 px-2 font-mono text-[10px] uppercase tracking-normal text-white/45 transition-colors duration-150 hover:border-white/30 hover:bg-white/[0.04] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:min-w-[4.75rem]"
          onClick={copyCommand}
          title={`${copyLabel} install command`}
          type="button"
        >
          <CopyStateIcon
            aria-hidden
            className={copyState === "copying" ? "size-3 animate-spin" : "size-3"}
            strokeWidth={1.5}
          />
          <span className="hidden sm:inline">{copyLabel}</span>
          <span aria-live="polite" className="sr-only">
            {copyLabel}
          </span>
        </button>
      </div>
    </div>
  );
}
