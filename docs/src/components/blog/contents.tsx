"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type Section = readonly [id: string, label: string, heading?: string];
type Input = "pointer" | "keyboard" | "scroll";

/** How long the page must stop scrolling before a clicked section gives way to the measured one. */
const SCROLL_SETTLE_MS = 250;
/** Releases a clicked section even when the click scrolled nothing, such as a section already in place. */
const NAVIGATION_TIMEOUT_MS = 5_000;

/**
 * The section whose anchor the reader has scrolled past, using native fragment-scroll offsets.
 * `navigate` holds a clicked section current until the smooth scroll it starts settles, so the
 * marker moves to it once instead of stepping through every section on the way.
 */
function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0]);
  const navigating = useRef<string>(undefined);
  const releaseTimer = useRef(0);
  const release = useRef(() => {});
  useEffect(() => {
    let frame = 0;
    function measure() {
      frame = 0;
      if (navigating.current) {
        setActive(navigating.current);
        return;
      }
      // Native fragment scrolling combines the document's scroll padding with the target's scroll
      // margin; allow a small buffer for font metrics settling after landing on a fragment.
      const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      let next = ids[0];
      for (const id of ids) {
        const section = document.getElementById(id);
        if (!section) continue;
        const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
        if (section.getBoundingClientRect().top <= padding + margin + 16) next = id;
      }
      setActive(next);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    release.current = () => {
      if (!navigating.current) return;
      window.clearTimeout(releaseTimer.current);
      navigating.current = undefined;
      schedule();
    };
    function scrolled() {
      if (navigating.current) {
        window.clearTimeout(releaseTimer.current);
        releaseTimer.current = window.setTimeout(release.current, SCROLL_SETTLE_MS);
      }
      schedule();
    }
    // A wheel or touch cancels the browser's smooth scroll, so the measured section takes over.
    const interrupted = () => release.current();
    measure();
    const events = ["resize", "hashchange", "pageshow"] as const;
    window.addEventListener("scroll", scrolled, { passive: true });
    for (const event of events) window.addEventListener(event, schedule, { passive: true });
    window.addEventListener("wheel", interrupted, { passive: true });
    window.addEventListener("touchstart", interrupted, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(releaseTimer.current);
      navigating.current = undefined;
      window.removeEventListener("scroll", scrolled);
      for (const event of events) window.removeEventListener(event, schedule);
      window.removeEventListener("wheel", interrupted);
      window.removeEventListener("touchstart", interrupted);
    };
  }, [ids]);
  const navigate = useCallback((id: string) => {
    navigating.current = id;
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => release.current(), NAVIGATION_TIMEOUT_MS);
    setActive(id);
  }, []);
  return [active, navigate] as const;
}

/**
 * "In this article" links with the current section marked as the reader scrolls. Native anchors
 * still work without JavaScript; scrolling and history stay native.
 */
export function BlogContents({ sections }: { sections: readonly Section[] }) {
  const ids = useMemo(() => sections.map(([id]) => id), [sections]);
  const [active, navigate] = useActiveSection(ids);
  const [input, setInput] = useState<Input>();
  const [pointer, setPointer] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [layout, setLayout] = useState<{ y: number; height: number; indicator: number }>();
  const [size, setSize] = useState(0);
  const nav = useRef<HTMLElement>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  // Re-measure when the column reflows, and mark a wheel or touch scroll as the input.
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize((value) => value + 1));
    observer.observe(element);
    const scrolled = () => setInput("scroll");
    window.addEventListener("wheel", scrolled, { passive: true });
    window.addEventListener("touchstart", scrolled, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("wheel", scrolled);
      window.removeEventListener("touchstart", scrolled);
    };
  }, []);

  const target = focused ?? pointer ?? active;
  useLayoutEffect(() => {
    const element = nav.current;
    const current = links.current.get(active);
    const highlighted = links.current.get(target);
    if (!element?.offsetHeight || !current || !highlighted) return;
    const bounds = current.getBoundingClientRect();
    setLayout({
      y: highlighted.offsetTop,
      height: highlighted.offsetHeight,
      indicator: bounds.top - element.getBoundingClientRect().top + (bounds.height - 18) / 2,
    });
  }, [active, target, size]);

  const finePointer = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

  return (
    <nav
      ref={nav}
      aria-label="On this page"
      className="blog-contents-links"
      data-input={input}
      data-highlight-ready={layout ? "true" : undefined}
      onPointerDown={() => setInput("pointer")}
      onPointerLeave={() => setPointer(undefined)}
      onPointerCancel={() => setPointer(undefined)}
    >
      <span
        className="blog-contents-highlight"
        aria-hidden="true"
        style={
          layout ? { transform: `translateY(${layout.y}px)`, height: layout.height } : undefined
        }
      />
      <span
        className="blog-contents-indicator"
        aria-hidden="true"
        style={layout ? { transform: `translateY(${layout.indicator}px)` } : undefined}
      />
      {sections.map(([id, label], index) => (
        <a
          key={id}
          ref={(element) => {
            if (element) links.current.set(id, element);
            else links.current.delete(id);
          }}
          href={`#${id}`}
          aria-current={id === active ? "location" : undefined}
          onClick={(event) => {
            // A modified click opens the link elsewhere and leaves this page where it is.
            const { button, metaKey, ctrlKey, shiftKey, altKey } = event;
            if (button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return;
            navigate(id);
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse" || !finePointer()) return;
            setInput("pointer");
            setPointer(id);
            setFocused(undefined);
          }}
          onFocus={(event) => {
            if (!event.currentTarget.matches(":focus-visible")) return;
            setInput("keyboard");
            setFocused(id);
            setPointer(undefined);
          }}
          onBlur={() => setFocused(undefined)}
        >
          <span className="blog-contents-index" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}
