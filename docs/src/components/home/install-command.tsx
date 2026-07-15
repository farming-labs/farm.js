"use client";

import { Bot, Check, Copy, LoaderCircle, RefreshCw, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import bunIconUrl from "simple-icons/icons/bun.svg?url";
import npmIconUrl from "simple-icons/icons/npm.svg?url";
import pnpmIconUrl from "simple-icons/icons/pnpm.svg?url";
import yarnIconUrl from "simple-icons/icons/yarn.svg?url";

type CommandOption = {
  label: string;
  command: string;
  kind: "install" | "agent";
  brand?: string;
  icon?: LucideIcon;
};

const commands: readonly CommandOption[] = [
  {
    label: "Agent",
    command:
      "Use Farm.js to build this React product app. Read the project docs first, then follow its app router, typed API, middleware, integration, and deployment conventions.",
    icon: Bot,
    kind: "agent",
  },
  {
    label: "npm",
    command: "npx @farmjs/create-app@beta",
    brand: npmIconUrl,
    kind: "install",
  },
  {
    label: "Yarn",
    command: "yarn dlx @farmjs/create-app@beta",
    brand: yarnIconUrl,
    kind: "install",
  },
  {
    label: "pnpm",
    command: "pnpm dlx @farmjs/create-app@beta",
    brand: pnpmIconUrl,
    kind: "install",
  },
  {
    label: "Bun",
    command: "bunx @farmjs/create-app@beta",
    brand: bunIconUrl,
    kind: "install",
  },
];

export function InstallCommand() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [fadeEdges, setFadeEdges] = useState({ left: false, right: false });
  const commandScrollRef = useRef<HTMLElement | null>(null);
  const resetTimer = useRef<number | undefined>(undefined);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeCommand = commands[activeIndex];
  const ActiveCommandIcon = activeCommand.kind === "agent" ? Bot : Terminal;
  const copyTarget = activeCommand.kind === "agent" ? "agent instruction" : "install command";
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

  useEffect(() => {
    const scrollArea = commandScrollRef.current;
    if (!scrollArea) return;

    scrollArea.scrollLeft = 0;

    function updateFadeEdges() {
      const maxScrollLeft = Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
      const nextEdges = {
        left: scrollArea.scrollLeft > 1,
        right: scrollArea.scrollLeft < maxScrollLeft - 1,
      };

      setFadeEdges((currentEdges) =>
        currentEdges.left === nextEdges.left && currentEdges.right === nextEdges.right
          ? currentEdges
          : nextEdges,
      );
    }

    updateFadeEdges();
    scrollArea.addEventListener("scroll", updateFadeEdges, { passive: true });
    const resizeObserver = new ResizeObserver(updateFadeEdges);
    resizeObserver.observe(scrollArea);

    return () => {
      scrollArea.removeEventListener("scroll", updateFadeEdges);
      resizeObserver.disconnect();
    };
  }, [activeIndex]);

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
    <div className="overflow-hidden border border-white/14 bg-black/95 shadow-[0_12px_36px_rgba(0,0,0,0.34)] backdrop-blur-sm">
      <div
        aria-label="Setup method"
        className="grid min-w-0 grid-cols-5 border-b border-white/10"
        role="tablist"
      >
        {commands.map((item, index) => {
          const TabIcon = item.icon;

          return (
            <button
              key={item.label}
              aria-controls="install-command-panel"
              aria-selected={activeIndex === index}
              className="group relative flex h-7 min-w-0 items-center justify-center gap-1 border-r border-white/10 px-1 font-mono text-[8px] font-normal uppercase tracking-normal text-white/42 transition-[background-color,color] duration-150 last:border-r-0 hover:bg-white/[0.055] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white aria-selected:bg-white aria-selected:text-black sm:h-8 sm:text-[9px]"
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
              {item.brand ? (
                <img
                  alt=""
                  aria-hidden="true"
                  className={`size-2.5 shrink-0 select-none transition-[filter,opacity] duration-150 ${
                    activeIndex === index
                      ? "brightness-0 opacity-90"
                      : "brightness-0 invert opacity-48 group-hover:opacity-90"
                  }`}
                  src={item.brand}
                />
              ) : TabIcon ? (
                <TabIcon
                  aria-hidden
                  className={`size-2.5 shrink-0 transition-opacity duration-150 ${
                    activeIndex === index ? "opacity-90" : "opacity-48 group-hover:opacity-90"
                  }`}
                  strokeWidth={1.5}
                />
              ) : null}
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`install-tab-${activeCommand.label.toLowerCase()}`}
        className="grid min-h-9 min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-stretch sm:min-h-10 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]"
        id="install-command-panel"
        role="tabpanel"
      >
        <span
          aria-hidden
          className="grid place-items-center border-r border-white/10 bg-white/[0.035] text-white/48"
        >
          <ActiveCommandIcon className="size-2.5" strokeWidth={1.5} />
        </span>
        <div className="relative min-w-0 overflow-hidden">
          <code
            className="flex h-full min-w-0 items-center overflow-x-auto whitespace-nowrap px-2 font-mono text-[9px] tracking-normal text-white/78 sm:px-2.5 sm:text-[10px]"
            ref={commandScrollRef}
            title={activeCommand.command}
          >
            <span aria-hidden className="mr-2 text-white/28">
              {activeCommand.kind === "agent" ? "AI" : "$"}
            </span>
            {activeCommand.command}
          </code>
          {activeCommand.kind === "agent" ? (
            <>
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black via-black/80 to-transparent transition-opacity duration-200 ${
                  fadeEdges.left ? "opacity-100" : "opacity-0"
                }`}
              />
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black via-black/80 to-transparent transition-opacity duration-200 ${
                  fadeEdges.right ? "opacity-100" : "opacity-0"
                }`}
              />
            </>
          ) : null}
        </div>
        <button
          aria-label={`${copyLabel} ${copyTarget}`}
          className="inline-flex min-w-9 shrink-0 items-center justify-center gap-1 border-l border-white/10 bg-white/[0.025] px-1.5 font-mono text-[8px] font-normal uppercase tracking-normal text-white/48 transition-[background-color,color] duration-150 hover:bg-white/[0.075] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white sm:min-w-[4.25rem] sm:px-2 sm:text-[9px]"
          onClick={copyCommand}
          title={`${copyLabel} ${copyTarget}`}
          type="button"
        >
          <CopyStateIcon
            aria-hidden
            className={copyState === "copying" ? "size-2.5 animate-spin" : "size-2.5"}
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
