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

export interface HighlightedCodeValueVariant {
  code: string;
  id: string;
}

interface HighlightedCodeTabsProps {
  autoRotateMs?: number;
  className?: string;
  compact?: boolean;
  copyable?: boolean;
  id: string;
  tabs: readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];
  tabsLabel?: string;
}

interface HighlightedCodeValueCycleProps {
  autoRotateMs: number;
  className?: string;
  compact?: boolean;
  copyable?: boolean;
  id: string;
  label: string;
  language: string;
  prefixCode: string;
  suffixCode: string;
  variants: readonly [HighlightedCodeValueVariant, ...HighlightedCodeValueVariant[]];
}

interface TypewriterValueCycleProps {
  className?: string;
  holdMs: number;
  mutedTrailingText?: string;
  variants: readonly [HighlightedCodeValueVariant, ...HighlightedCodeValueVariant[]];
}

type TypewriterPhase = "holding" | "deleting" | "typing";

interface TypewriterState {
  activeIndex: number;
  displayedCode: string;
  phase: TypewriterPhase;
  targetIndex: number;
}

const TYPEWRITER_DELETE_DELAY_MS = 14;
const TYPEWRITER_START_DELAY_MS = 180;
const TYPEWRITER_TYPE_DELAY_MS = 22;

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

function renderHighlightedCode(code: string, highlightLines: readonly number[] = []) {
  const highlightedLineNumbers = new Set(highlightLines);

  return highlight(code)
    .split("\n")
    .map((line, index) =>
      highlightedLineNumbers.has(index + 1)
        ? line.replace('class="sh__line"', 'class="sh__line sh__line--highlighted"')
        : line,
    )
    .join("");
}

function useAutoRotatingIndex(autoRotateMs: number | undefined, itemCount: number) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!autoRotateMs || itemCount < 2) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % itemCount);
    }, autoRotateMs);

    return () => window.clearInterval(timer);
  }, [autoRotateMs, itemCount]);

  return [activeIndex, setActiveIndex] as const;
}

function commonPrefixLength(first: string, second: string) {
  const comparableLength = Math.min(first.length, second.length);
  let index = 0;

  while (index < comparableLength && first[index] === second[index]) index += 1;

  return index;
}

function useTypewriterVariant(
  holdMs: number,
  variants: readonly [HighlightedCodeValueVariant, ...HighlightedCodeValueVariant[]],
) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [state, setState] = useState<TypewriterState>(() => ({
    activeIndex: 0,
    displayedCode: variants[0].code,
    phase: "holding",
    targetIndex: 0,
  }));

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(reducedMotion.matches);

    updatePreference();
    reducedMotion.addEventListener("change", updatePreference);

    return () => reducedMotion.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || variants.length < 2) {
      setState((current) => {
        const firstVariant = variants[0];

        if (
          current.activeIndex === 0 &&
          current.displayedCode === firstVariant.code &&
          current.phase === "holding" &&
          current.targetIndex === 0
        ) {
          return current;
        }

        return {
          activeIndex: 0,
          displayedCode: firstVariant.code,
          phase: "holding",
          targetIndex: 0,
        };
      });
      return;
    }

    let delay = 0;
    let updateState: (current: TypewriterState) => TypewriterState;

    if (state.phase === "holding") {
      delay = holdMs;
      updateState = (current) => ({
        ...current,
        phase: "deleting",
        targetIndex: (current.activeIndex + 1) % variants.length,
      });
    } else if (state.phase === "deleting") {
      const currentCode = variants[state.activeIndex]?.code ?? variants[0].code;
      const targetCode = variants[state.targetIndex]?.code ?? variants[0].code;
      const retainedLength = commonPrefixLength(currentCode, targetCode);

      if (state.displayedCode.length > retainedLength) {
        delay = TYPEWRITER_DELETE_DELAY_MS;
        updateState = (current) => ({
          ...current,
          displayedCode: current.displayedCode.slice(0, -1),
        });
      } else {
        delay = TYPEWRITER_START_DELAY_MS;
        updateState = (current) => ({
          ...current,
          activeIndex: current.targetIndex,
          phase: "typing",
        });
      }
    } else {
      const targetCode = variants[state.activeIndex]?.code ?? variants[0].code;

      if (state.displayedCode.length < targetCode.length) {
        delay = TYPEWRITER_TYPE_DELAY_MS;
        updateState = (current) => ({
          ...current,
          displayedCode: targetCode.slice(0, current.displayedCode.length + 1),
        });
      } else {
        updateState = (current) => ({ ...current, phase: "holding" });
      }
    }

    const timer = window.setTimeout(() => setState(updateState), delay);

    return () => window.clearTimeout(timer);
  }, [holdMs, prefersReducedMotion, state, variants]);

  return state;
}

export function TypewriterValueCycle({
  className,
  holdMs,
  mutedTrailingText,
  variants,
}: TypewriterValueCycleProps) {
  const typewriter = useTypewriterVariant(holdMs, variants);
  const trailingText = mutedTrailingText ?? "";
  const hasMutedTrailingText = Boolean(
    trailingText && typewriter.displayedCode.endsWith(trailingText),
  );
  const primaryText = hasMutedTrailingText
    ? typewriter.displayedCode.slice(0, -trailingText.length)
    : typewriter.displayedCode;

  return (
    <span
      className={["farm-inline-typewriter", className].filter(Boolean).join(" ")}
      data-typewriter-phase={typewriter.phase}
    >
      {primaryText || (hasMutedTrailingText ? null : "\u200b")}
      {hasMutedTrailingText ? <span className="text-white/42">{trailingText}</span> : null}
    </span>
  );
}

function HighlightedCodeBody({
  ariaLabel,
  ariaLabelledBy,
  code,
  compact = false,
  animated = false,
  highlightLines = [],
  id,
  role,
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  code: string;
  compact?: boolean;
  animated?: boolean;
  highlightLines?: readonly number[];
  id?: string;
  role?: "tabpanel";
}) {
  const highlightedCode = renderHighlightedCode(code.trim(), highlightLines);

  return (
    <pre
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={[
        "min-h-0 max-w-full flex-1 overflow-x-auto font-mono tracking-normal",
        animated && "farm-code-cycle-panel",
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

export function HighlightedCodeValueCycle({
  autoRotateMs,
  className,
  compact = false,
  copyable = false,
  id,
  label,
  language,
  prefixCode,
  suffixCode,
  variants,
}: HighlightedCodeValueCycleProps) {
  const typewriter = useTypewriterVariant(autoRotateMs, variants);
  const activeVariant = variants[typewriter.activeIndex] ?? variants[0];
  const completeCode = `${prefixCode}\n${activeVariant.code}\n${suffixCode}`;
  const visibleValue = typewriter.displayedCode || " ";
  const valueLineCount = visibleValue.split("\n").length;
  const highlightedValue = renderHighlightedCode(
    visibleValue,
    Array.from({ length: valueLineCount }, (_, index) => index + 1),
  );

  return (
    <figure className={figureClassName(className)}>
      <figcaption className="flex h-10 min-w-0 items-center justify-between gap-4 border-b border-white/8 px-4 font-mono text-[9px] tracking-normal text-white/38">
        <span className="flex min-w-0 items-center gap-2">
          <Code2 aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
          <span className="truncate text-white/72">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="uppercase text-white/24">{language}</span>
          {copyable ? <CopyCodeButton code={completeCode} label={label} /> : null}
        </span>
      </figcaption>
      <pre
        aria-label={`${label} code`}
        className={[
          "min-h-0 max-w-full flex-1 overflow-x-auto font-mono tracking-normal",
          compact
            ? "py-1 text-[10.5px] leading-[18px] sm:text-[11px]"
            : "py-2 text-[9.5px] leading-4 sm:text-[10px]",
        ].join(" ")}
        id={id}
        tabIndex={0}
      >
        <code
          className={[
            "farm-highlighted-code farm-highlighted-code--value-cycle block min-w-full",
            compact && "farm-highlighted-code--value-cycle-compact",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span dangerouslySetInnerHTML={{ __html: renderHighlightedCode(prefixCode) }} />
          <span
            className="farm-code-typewriter block"
            dangerouslySetInnerHTML={{ __html: highlightedValue }}
          />
          <span dangerouslySetInnerHTML={{ __html: renderHighlightedCode(suffixCode) }} />
        </code>
      </pre>
    </figure>
  );
}

export function HighlightedCodeTabs({
  autoRotateMs,
  className,
  compact = false,
  copyable = false,
  id,
  tabs,
  tabsLabel = "Code examples",
}: HighlightedCodeTabsProps) {
  const [activeIndex, setActiveIndex] = useAutoRotatingIndex(autoRotateMs, tabs.length);
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
        <span className="flex shrink-0 items-stretch uppercase text-white/24">
          <span className="flex items-center px-3">{activeTab.language}</span>
          {copyable ? <CopyCodeButton code={activeTab.code} label={activeTab.label} /> : null}
        </span>
      </figcaption>
      <HighlightedCodeBody
        key={activeTab.id}
        ariaLabelledBy={`${id}-${activeTab.id}-tab`}
        animated={Boolean(autoRotateMs)}
        code={activeTab.code}
        compact={compact}
        highlightLines={activeTab.highlightLines}
        id={panelId}
        role="tabpanel"
      />
    </figure>
  );
}
