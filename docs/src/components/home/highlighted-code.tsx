"use client";

import { Check, Code2, Copy, RefreshCw } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { highlight } from "sugar-high";

interface HighlightedCodeProps {
  className?: string;
  code: string;
  copyable?: boolean;
  highlightLines?: readonly number[];
  label: string;
  language: string;
  prefix?: string;
}

export interface HighlightedCodeTab {
  code: string;
  highlightLines?: readonly number[];
  id: string;
  label: string;
  language: string;
}

interface HighlightedCodeTabsProps {
  className?: string;
  compact?: boolean;
  id: string;
  tabs: readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];
  tabsLabel?: string;
}

function figureClassName(className?: string) {
  return [
    "min-w-0 max-w-full overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)]",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

function copyWithSelection(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const didCopy = document.execCommand("copy");
  textarea.remove();
  return didCopy;
}

function CopyCodeButton({ code, label }: { code: string; label: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  const copyLabel = copyState === "copied" ? "Copied" : copyState === "failed" ? "Retry" : "Copy";
  const CopyStateIcon = copyState === "copied" ? Check : copyState === "failed" ? RefreshCw : Copy;

  useEffect(() => {
    return () => window.clearTimeout(resetTimer.current);
  }, []);

  async function copyCode() {
    let didCopy = false;

    try {
      didCopy = copyWithSelection(code);
    } catch {
      // Continue with the asynchronous Clipboard API.
    }

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(code);
      didCopy = true;
    } catch {
      // Keep the synchronous selection fallback result.
    }

    window.clearTimeout(resetTimer.current);
    setCopyState(didCopy ? "copied" : "failed");
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1600);
  }

  return (
    <button
      aria-label={`${copyLabel} ${label} code`}
      className="inline-flex min-w-[4.5rem] items-center justify-center gap-1.5 border-l border-white/10 pl-3 uppercase text-white/42 transition-colors duration-150 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      onClick={copyCode}
      title={`${copyLabel} ${label} code`}
      type="button"
    >
      <CopyStateIcon aria-hidden className="size-2.5" strokeWidth={1.5} />
      <span>{copyLabel}</span>
      <span aria-live="polite" className="sr-only">
        {copyLabel}
      </span>
    </button>
  );
}

function HighlightedCodeBody({
  ariaLabel,
  ariaLabelledBy,
  code,
  compact = false,
  highlightLines = [],
  id,
  role,
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  code: string;
  compact?: boolean;
  highlightLines?: readonly number[];
  id?: string;
  role?: "tabpanel";
}) {
  const highlightedLineNumbers = new Set(highlightLines);
  const highlightedCode = highlight(code.trim())
    .split("\n")
    .map((line, index) =>
      highlightedLineNumbers.has(index + 1)
        ? line.replace('class="sh__line"', 'class="sh__line sh__line--highlighted"')
        : line,
    )
    .join("");

  return (
    <pre
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={[
        "min-h-0 max-w-full flex-1 overflow-x-auto font-mono tracking-normal",
        compact
          ? "py-2 text-[10px] leading-5 sm:text-[10.5px]"
          : "py-4 text-[10.5px] leading-6 sm:text-[11px]",
      ].join(" ")}
      id={id}
      role={role}
      tabIndex={0}
    >
      <code
        className={[
          "farm-highlighted-code block min-w-full",
          compact && "farm-highlighted-code--compact",
        ]
          .filter(Boolean)
          .join(" ")}
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
    </pre>
  );
}

export function HighlightedCode({
  className,
  code,
  copyable = false,
  highlightLines,
  label,
  language,
  prefix,
}: HighlightedCodeProps) {
  return (
    <figure className={figureClassName(className)}>
      <figcaption className="flex h-10 min-w-0 items-center justify-between gap-4 border-b border-white/8 px-4 font-mono text-[9px] tracking-normal text-white/38">
        <span className="flex min-w-0 items-center gap-2">
          <Code2 aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
          {prefix ? <span className="shrink-0 font-semibold text-white/72">{prefix}</span> : null}
          <span className="truncate">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="uppercase text-white/24">{language}</span>
          {copyable ? <CopyCodeButton code={code} label={label} /> : null}
        </span>
      </figcaption>
      <HighlightedCodeBody
        ariaLabel={`${prefix ? `${prefix} ` : ""}${label} code`}
        code={code}
        highlightLines={highlightLines}
      />
    </figure>
  );
}

export function HighlightedCodeTabs({
  className,
  compact = false,
  id,
  tabs,
  tabsLabel = "Code examples",
}: HighlightedCodeTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeTab = tabs[activeIndex] ?? tabs[0];
  const panelId = `${id}-panel`;

  function selectTab(index: number) {
    setActiveIndex(index);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectTab(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <figure className={figureClassName(className)}>
      <figcaption className="flex h-10 min-w-0 items-stretch border-b border-white/8 font-mono text-[8px] tracking-normal text-white/38 sm:text-[9px]">
        <span
          aria-hidden
          className="grid w-9 shrink-0 place-items-center border-r border-white/8 text-white/34"
        >
          <Code2 className="size-3" strokeWidth={1.5} />
        </span>
        <span aria-label={tabsLabel} className="flex min-w-0 flex-1 items-stretch" role="tablist">
          {tabs.map((tab, index) => {
            const tabId = `${id}-${tab.id}-tab`;

            return (
              <button
                key={tab.id}
                aria-controls={panelId}
                aria-selected={activeIndex === index}
                className="relative flex h-full min-w-0 flex-1 items-center justify-center border-r border-white/8 px-2 text-white/34 transition-[background-color,color,box-shadow] duration-150 hover:bg-white/[0.035] hover:text-white/68 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white aria-selected:bg-white/[0.045] aria-selected:text-white/82 aria-selected:shadow-[inset_0_-1px_0_rgba(255,255,255,0.85)]"
                id={tabId}
                onClick={() => selectTab(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                role="tab"
                tabIndex={activeIndex === index ? 0 : -1}
                title={tab.label}
                type="button"
              >
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </span>
        <span className="flex shrink-0 items-center px-3 uppercase text-white/24">
          {activeTab.language}
        </span>
      </figcaption>
      <HighlightedCodeBody
        ariaLabelledBy={`${id}-${activeTab.id}-tab`}
        code={activeTab.code}
        compact={compact}
        highlightLines={activeTab.highlightLines}
        id={panelId}
        role="tabpanel"
      />
    </figure>
  );
}
