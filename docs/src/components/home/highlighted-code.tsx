"use client";

import { Code2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { highlight } from "sugar-high";

interface HighlightedCodeProps {
  className?: string;
  code: string;
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

function HighlightedCodeBody({
  ariaLabel,
  ariaLabelledBy,
  code,
  highlightLines = [],
  id,
  role,
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  code: string;
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
      className="min-h-0 max-w-full flex-1 overflow-x-auto py-4 font-mono text-[10.5px] leading-6 tracking-normal sm:text-[11px]"
      id={id}
      role={role}
      tabIndex={0}
    >
      <code
        className="farm-highlighted-code block min-w-full"
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
    </pre>
  );
}

export function HighlightedCode({
  className,
  code,
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
        <span className="shrink-0 uppercase text-white/24">{language}</span>
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
  tabs,
  tabsLabel = "Code examples",
}: HighlightedCodeTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const groupId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeTab = tabs[activeIndex] ?? tabs[0];
  const panelId = `${groupId}-panel`;

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
            const tabId = `${groupId}-${tab.id}-tab`;

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
        ariaLabelledBy={`${groupId}-${activeTab.id}-tab`}
        code={activeTab.code}
        highlightLines={activeTab.highlightLines}
        id={panelId}
        role="tabpanel"
      />
    </figure>
  );
}
