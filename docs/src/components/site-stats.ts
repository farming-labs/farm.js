// Live GitHub stars for the site header. The count comes from /api/stats (cached at the CDN)
// after hydration, so the server HTML and the first client render match, and a count that
// isn't available never shows a made-up number.
import { useEffect, useRef, useState } from "react";
import type { SiteStats } from "../app/api/stats/route";
import { createScramble } from "./scramble";

/** What a readout shows before its count arrives, or when it never does. */
export const NO_READING = "--";
/** How long a count takes to settle out of the glyphs. */
const SETTLE_MS = 850;
/** Glyphs re-roll at this pace rather than every frame, so they read as characters, not noise. */
const ROLL_MS = 50;

/** 684 stays 684; 5531 is 5.5k; 22404 is 22k; 1250000 is 1.3M. */
export function formatCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

let request: Promise<SiteStats | null> | undefined;

/** One request per page load, shared by every header that asks. */
function loadSiteStats(): Promise<SiteStats | null> {
  request ??= fetch("/api/stats", { headers: { accept: "application/json" } })
    .then((response) => (response.ok ? (response.json() as Promise<SiteStats>) : null))
    .catch(() => null);
  return request;
}

export function useSiteStats(): SiteStats | null {
  const [stats, setStats] = useState<SiteStats | null>(null);
  useEffect(() => {
    let active = true;
    void loadSiteStats().then((value) => {
      if (active) setStats(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return stats;
}

/**
 * Writes `text` into the returned element with the hero's scramble: the characters run through
 * dim glyphs and settle left to right when the count arrives, and again on `replay` (hover or
 * focus). Each character is its own span with `data-settled`, so CSS can fade it up as it
 * lands. React only ever renders NO_READING, so nothing re-renders per frame. Reduced motion
 * writes the count straight away.
 */
export function useScrambledText(text: string | undefined) {
  const ref = useRef<HTMLSpanElement>(null);
  const replay = useRef(() => {});
  useEffect(() => {
    const element = ref.current;
    if (!element || text === undefined) return;
    let frame = 0;
    const paint = (value: string, settled: (index: number) => boolean) => {
      const cells = element.children;
      // The first paint replaces React's placeholder text with one span per character.
      if (cells.length === 0) element.textContent = "";
      while (cells.length < value.length) element.append(document.createElement("span"));
      while (cells.length > value.length) cells[cells.length - 1]!.remove();
      for (let index = 0; index < value.length; index += 1) {
        const cell = cells[index] as HTMLElement;
        if (cell.textContent !== value[index]) cell.textContent = value[index]!;
        cell.dataset.settled = String(settled(index));
      }
    };
    const settle = (from: string) => {
      cancelAnimationFrame(frame);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        paint(text, () => true);
        return;
      }
      const scramble = createScramble(from, text);
      const start = performance.now();
      let rolledAt = -Infinity;
      const tick = (now: number) => {
        const amount = Math.min(1, (now - start) / SETTLE_MS);
        if (amount === 1 || now - rolledAt >= ROLL_MS) {
          rolledAt = now;
          paint(scramble.at(from, text, amount), (index) => scramble.settled(index, amount));
        }
        if (amount < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    settle(element.textContent ?? NO_READING);
    replay.current = () => settle(text);
    return () => {
      cancelAnimationFrame(frame);
      replay.current = () => {};
    };
  }, [text]);
  return { ref, replay: () => replay.current() };
}
