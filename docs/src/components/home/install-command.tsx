"use client";

import { Check, Copy, LoaderCircle, RefreshCw, Terminal } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import bunIconUrl from "simple-icons/icons/bun.svg?url";
import npmIconUrl from "simple-icons/icons/npm.svg?url";
import pnpmIconUrl from "simple-icons/icons/pnpm.svg?url";
import yarnIconUrl from "simple-icons/icons/yarn.svg?url";

const commands = [
  { label: "npm", command: "npm create farm@latest", icon: npmIconUrl },
  { label: "Yarn", command: "yarn create farm", icon: yarnIconUrl },
  { label: "pnpm", command: "pnpm create farm@latest", icon: pnpmIconUrl },
  { label: "Bun", command: "bun create farm", icon: bunIconUrl },
] as const;

export function InstallCommand() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
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

  function selectCommand(index: number) {
    window.clearTimeout(resetTimer.current);
    setActiveIndex(index);
    setCopyState("idle");
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") nextIndex = (index + 1) % commands.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + commands.length) % commands.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = commands.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectCommand(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

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
    <div className="overflow-hidden border border-white/14 bg-black/95 shadow-[0_22px_70px_rgba(0,0,0,0.52)] backdrop-blur-sm">
      <div
        aria-label="Package manager"
        className="grid min-w-0 grid-cols-4 border-b border-white/10"
        role="tablist"
      >
        {commands.map((item, index) => (
          <button
            key={item.label}
            aria-controls="install-command-panel"
            aria-selected={activeIndex === index}
            className="group relative flex h-11 min-w-0 items-center justify-center gap-2 border-r border-white/10 px-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/42 transition-[background-color,color] duration-150 last:border-r-0 hover:bg-white/[0.055] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white aria-selected:bg-white aria-selected:text-black sm:h-12 sm:text-[11px]"
            id={`install-tab-${item.label.toLowerCase()}`}
            onClick={() => selectCommand(index)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            role="tab"
            tabIndex={activeIndex === index ? 0 : -1}
            type="button"
          >
            <img
              alt=""
              aria-hidden="true"
              className={`size-3.5 shrink-0 select-none transition-[filter,opacity] duration-150 sm:size-4 ${
                activeIndex === index
                  ? "brightness-0 opacity-90"
                  : "brightness-0 invert opacity-48 group-hover:opacity-90"
              }`}
              src={item.icon}
            />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`install-tab-${activeCommand.label.toLowerCase()}`}
        className="grid min-h-14 min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-stretch sm:min-h-16 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto]"
        id="install-command-panel"
        role="tabpanel"
      >
        <span
          aria-hidden
          className="grid place-items-center border-r border-white/10 bg-white/[0.035] text-white/48"
        >
          <Terminal className="size-3.5 sm:size-4" strokeWidth={1.5} />
        </span>
        <code className="flex min-w-0 items-center overflow-x-auto whitespace-nowrap px-3 font-mono text-xs tracking-normal text-white/78 sm:px-5 sm:text-[13px]">
          <span aria-hidden className="mr-2.5 text-white/28">
            $
          </span>
          {activeCommand.command}
        </code>
        <button
          aria-label={`${copyLabel} install command`}
          className="inline-flex min-w-12 shrink-0 items-center justify-center gap-2 border-l border-white/10 bg-white/[0.025] px-3 font-mono text-[9px] font-normal uppercase tracking-normal text-white/48 transition-[background-color,color] duration-150 hover:bg-white/[0.075] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white sm:min-w-[6.25rem] sm:px-4 sm:text-[10px]"
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
