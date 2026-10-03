"use client";

import { useEffect, useRef } from "react";

// The launch video's look: characters run through these signs before they settle.
const GLYPHS = "#%&/_<>*+=!?01";

// One loop, in milliseconds. A cursor drags a selection over a word (which may
// scramble into another), drags a wire from the selection into a target and
// clicks it, and then everything unwinds.
const STEPS = [
  ["rest", 700],
  ["glide", 520],
  ["press", 120],
  ["drag", 720],
  ["release", 140],
  ["scramble", 480],
  ["toPort", 460],
  ["grab", 120],
  ["wire", 860],
  ["connect", 180],
  ["toTarget", 380],
  ["click", 160],
  ["lit", 520],
  ["hold", 2800],
  ["unwire", 360],
  ["unscramble", 480],
  ["deselect", 620],
] as const;
type Step = (typeof STEPS)[number][0];
const AT = {} as Record<Step, number>;
let elapsed = 0;
for (const [step, duration] of STEPS) {
  AT[step] = elapsed;
  elapsed += duration;
}
const LOOP_MS = elapsed;
const DURATION = Object.fromEntries(STEPS) as Record<Step, number>;
// Where the loop waits while the word is hovered or the target focused: lit, cursor gone.
const CURSOR_LEAVE_MS = 460;
const HOLD_AT = AT.hold + CURSOR_LEAVE_MS + 100;
// The video's click: two rings, a beat apart, grow from the cursor and fade.
const RIPPLE_MS = 700;
const RIPPLE_GAP_MS = 120;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - (-2 * value + 2) ** 3 / 2;
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const progress = (t: number, step: Step) => clamp((t - AT[step]) / DURATION[step]);
const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;

/**
 * Scrambles between two strings through GLYPHS. Each character settles at its
 * own point (left to right, with jitter, reseeded every loop), and the string
 * grows or shrinks a character at a time between the two lengths.
 */
function createScramble(a: string, b: string) {
  const length = Math.max(a.length, b.length);
  let settleAt: number[] = [];
  const reseed = () => {
    settleAt = Array.from({ length }, (_, index) => (index / length) * 0.7 + Math.random() * 0.3);
  };
  reseed();
  const at = (from: string, to: string, amount: number) => {
    if (amount <= 0) return from;
    if (amount >= 1) return to;
    const visible = Math.round(lerp(from.length, to.length, amount));
    let next = "";
    for (let index = 0; index < Math.min(length, visible); index += 1) {
      next += amount >= settleAt[index]! ? (to[index] ?? "") : randomGlyph();
    }
    return next;
  };
  return { reseed, at };
}

type Point = [number, number];
type Box = { left: number; top: number; right: number; bottom: number };

/** SVG path with rounded elbows through the given points, as the blog figures draw wires. */
function roundPath(points: Point[], radius = 9): string {
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    const la = Math.hypot(x1 - x0, y1 - y0) || 1;
    const lb = Math.hypot(x2 - x1, y2 - y1) || 1;
    const a = Math.min(radius, la / 2);
    const b = Math.min(radius, lb / 2);
    d += ` L${x1 - ((x1 - x0) / la) * a} ${y1 - ((y1 - y0) / la) * a}`;
    d += ` Q${x1} ${y1} ${x1 + ((x2 - x1) / lb) * b} ${y1 + ((y2 - y1) / lb) * b}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  return `${d} L${lx} ${ly}`;
}

/** The part of a polyline from its start to `amount` of its length, and the point it ends at. */
function partOf(points: Point[], amount: number): { points: Point[]; tip: Point } {
  const lengths = points
    .slice(1)
    .map((point, i) => Math.hypot(point[0] - points[i]![0], point[1] - points[i]![1]));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * clamp(amount);
  const part: Point[] = [points[0]!];
  for (let i = 0; i < lengths.length; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    if (remaining >= lengths[i]!) {
      part.push([bx, by]);
      remaining -= lengths[i]!;
      continue;
    }
    const ratio = lengths[i] ? remaining / lengths[i]! : 0;
    const tip: Point = [lerp(ax, bx, ratio), lerp(ay, by, ratio)];
    part.push(tip);
    return { points: part, tip };
  }
  return { points: part, tip: points[points.length - 1]! };
}

/**
 * How the wire runs from the selection to the target.
 * - "below": from the selection's bottom edge, down, then across into the
 *   target's left side (the target hangs below the line, to the right).
 * - "hug": follows the copy without crossing it. From the selection's bottom
 *   edge it drops into the gap above the next line (`over`), runs right along
 *   its top, turns down once past the copy (`over` and `clear`), and enters the
 *   target from its right side. Where that gap is too tight to run in (small
 *   screens), it leaves from the selection's right side instead.
 */
type Route = "below" | "hug";

function routeFor(
  route: Route,
  selection: Box,
  target: Box,
  hug: { runY: number | null; gutterX: number },
): Point[] {
  const portX = selection.right - Math.min(24, (selection.right - selection.left) / 4);
  const targetY = (target.top + target.bottom) / 2;
  if (route === "below") {
    return [
      [portX, selection.bottom],
      [portX, targetY],
      [target.left, targetY],
    ];
  }
  if (hug.runY === null) {
    const sideY = (selection.top + selection.bottom) / 2;
    return [
      [selection.right, sideY],
      [hug.gutterX, sideY],
      [hug.gutterX, targetY],
      [target.right, targetY],
    ];
  }
  return [
    [portX, selection.bottom],
    [portX, hug.runY],
    [hug.gutterX, hug.runY],
    [hug.gutterX, targetY],
    [target.right, targetY],
  ];
}

export type SelectionWireProps = {
  /** Selector, within the parent element, of the word the selection lands on. */
  word: string;
  /** Selector of the element the wire connects to and the cursor clicks. */
  target: string;
  /** Selector of the heading the word is in; it sets the selection's padding. */
  heading: string;
  route: Route;
  /** Scramble the word into another and back, writing into this element. */
  swap?: { text: string; from: string; to: string };
  /** Hang the target under the heading, right of the selection (the target must be absolute). */
  placeTargetUnderHeading?: boolean;
  /** Hovering or focusing the target also holds it connected. */
  holdOnTarget?: boolean;
  /** Clear and pause while focus is inside this element, such as a form someone is filling in. */
  pauseWithin?: string;
  /** The selection's side padding, in em: tighter keeps neighbouring glyphs out. */
  padX?: number;
  /**
   * Scramble the target's label into `to` when the cursor clicks it, and back
   * once the wire is gone. `text` selects the label inside the target. The
   * label is only written while it still shows what this animation last wrote,
   * so the page's own updates to it (such as "Joining…") always win.
   */
  targetLabel?: { text: string; to: string };
  /** The selection's right padding, in em, when it differs from `padX`. */
  padRight?: number;
  /**
   * Fit the selection's height to the word's ink (its letters' actual extent)
   * instead of its line box, leaving room between it and the line below.
   */
  fitInk?: boolean;
  /** For the "hug" route: the line under the selection whose top the wire runs along. */
  over?: string;
  /** For the "hug" route: more copy the wire must pass on its right, such as a paragraph. */
  clear?: string;
};

/**
 * The animated layer: a selection, a wire, the click's rings and a cursor,
 * drawn over the parent element (which must be positioned). Everything moves
 * on one requestAnimationFrame timeline that writes to the DOM directly, like
 * the blog figures, so React never re-renders mid-loop. The target carries
 * `data-sw-state` (off, target, linked, hover, press, on) for its own styling.
 * Reduced motion shows the connected state, still and without a swap.
 */
export function SelectionWire({
  word: wordSelector,
  target: targetSelector,
  heading: headingSelector,
  route,
  swap,
  placeTargetUnderHeading = false,
  holdOnTarget = false,
  pauseWithin,
  padX = 0.16,
  targetLabel,
  padRight = padX,
  fitInk = false,
  over,
  clear,
}: SelectionWireProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<SVGSVGElement>(null);
  const wireRef = useRef<SVGPathElement>(null);
  const portRef = useRef<SVGCircleElement>(null);
  const endRef = useRef<SVGCircleElement>(null);
  const rippleARef = useRef<HTMLSpanElement>(null);
  const rippleBRef = useRef<HTMLSpanElement>(null);
  const labelSelector = targetLabel?.text;
  const labelTo = targetLabel?.to;
  const swapText = swap?.text;
  const swapFrom = swap?.from;
  const swapTo = swap?.to;

  useEffect(() => {
    const layer = layerRef.current;
    const root = layer?.parentElement;
    const select = selectRef.current;
    const cursor = cursorRef.current;
    const wire = wireRef.current;
    const port = portRef.current;
    const end = endRef.current;
    // Copies: React clears ref slots on unmount before this effect's cleanup runs.
    const ripples = [rippleARef.current, rippleBRef.current];
    const wordBox = root?.querySelector<HTMLElement>(wordSelector);
    const target = root?.querySelector<HTMLElement>(targetSelector);
    const heading = root?.querySelector<HTMLElement>(headingSelector);
    const text = swapText ? root?.querySelector<HTMLElement>(swapText) : null;
    const pauseZone = pauseWithin ? root?.querySelector<HTMLElement>(pauseWithin) : null;
    const overLine = over ? root?.querySelector<HTMLElement>(over) : null;
    const label = labelSelector ? target?.querySelector<HTMLElement>(labelSelector) : null;
    const cleared = [
      ...(overLine ? [overLine] : []),
      ...(clear ? [...(root?.querySelectorAll<HTMLElement>(clear) ?? [])] : []),
    ];
    if (
      !layer ||
      !root ||
      !select ||
      !cursor ||
      !wire ||
      !port ||
      !end ||
      !ripples[0] ||
      !ripples[1] ||
      !wordBox ||
      !target ||
      !heading
    ) {
      return;
    }
    const swapping = Boolean(text && swapFrom && swapTo);
    const fromText = swapFrom ?? "";
    const toText = swapTo ?? "";

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let fromWidth = 0;
    let toWidth = 0;
    let fontSize = 16;
    // How far below its box top the `over` line's ink starts (tallest glyph), from canvas metrics.
    let overInkOffset = 0;
    // The word's ink, as offsets from its box top, for `fitInk`.
    let wordInkTop = 0;
    let wordInkBottom = 0;
    const metrics = document.createElement("canvas").getContext("2d");
    // Both words' widths, measured in place: the text is swapped and restored
    // within one task, so nothing paints in between.
    const measure = () => {
      fontSize = parseFloat(getComputedStyle(heading).fontSize) || 16;
      if (overLine && metrics) {
        const style = getComputedStyle(overLine);
        metrics.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const ink = metrics.measureText(overLine.textContent ?? "");
        overInkOffset = ink.fontBoundingBoxAscent - ink.actualBoundingBoxAscent;
      }
      if (fitInk && metrics) {
        const style = getComputedStyle(wordBox);
        metrics.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        // Both words when swapping, so the selection keeps one height throughout.
        const words = swapping ? [fromText, toText] : [wordBox.textContent ?? ""];
        const inks = words.map((value) => metrics.measureText(value));
        const fontAscent = inks[0]!.fontBoundingBoxAscent;
        wordInkTop = fontAscent - Math.max(...inks.map((ink) => ink.actualBoundingBoxAscent));
        wordInkBottom = fontAscent + Math.max(...inks.map((ink) => ink.actualBoundingBoxDescent));
      }
      if (!swapping || !text) return;
      const savedText = text.textContent;
      const savedWidth = wordBox.style.width;
      wordBox.style.width = "auto";
      text.textContent = fromText;
      fromWidth = wordBox.getBoundingClientRect().width;
      text.textContent = toText;
      toWidth = wordBox.getBoundingClientRect().width;
      text.textContent = savedText;
      wordBox.style.width = savedWidth;
    };

    const wordScramble = createScramble(fromText, toText);
    let shownText = text?.textContent ?? "";

    // The target's label: its resting text, and what this animation last wrote.
    const labelFrom = label?.textContent ?? "";
    const labelScramble = label && labelTo ? createScramble(labelFrom, labelTo) : null;
    let labelWritten = labelFrom;
    const renderLabel = (t: number) => {
      if (!label || !labelTo || !labelScramble) return;
      // Someone else changed it: leave it alone until it is back at rest.
      if (label.textContent !== labelWritten) {
        if (label.textContent !== labelFrom) return;
        labelWritten = labelFrom;
        target.style.removeProperty("min-width");
      }
      const next = still
        ? labelFrom
        : t < AT.unscramble
          ? labelScramble.at(labelFrom, labelTo, clamp((t - AT.click) / DURATION.scramble))
          : labelScramble.at(labelTo, labelFrom, progress(t, "unscramble"));
      if (next === labelWritten) return;
      // Hold the target's width while the label differs, so nothing beside it moves.
      if (labelWritten === labelFrom) {
        target.style.minWidth = `${target.getBoundingClientRect().width}px`;
      }
      label.textContent = next;
      labelWritten = next;
      if (next === labelFrom) target.style.removeProperty("min-width");
    };

    // The box of an element's text itself, not of the element.
    const rangeRect = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const relative = (box: DOMRect, origin: DOMRect): Box => ({
      left: box.left - origin.left,
      top: box.top - origin.top,
      right: box.right - origin.left,
      bottom: box.bottom - origin.top,
    });

    const render = (t: number) => {
      if (pauseZone?.matches(":focus-within")) {
        if (swapping && text) {
          wordBox.style.width = `${fromWidth}px`;
          text.textContent = fromText;
          shownText = fromText;
        }
        select.style.opacity = "0";
        wire.style.opacity = "0";
        port.style.opacity = "0";
        end.style.opacity = "0";
        cursor.style.opacity = "0";
        for (const ripple of ripples) ripple!.style.opacity = "0";
        target.dataset.swState = "off";
        target.style.removeProperty("--sw-fade");
        if (!placeTargetUnderHeading) target.style.transform = "";
        if (label && label.textContent === labelWritten) {
          label.textContent = labelFrom;
          labelWritten = labelFrom;
          target.style.removeProperty("min-width");
        }
        return;
      }

      if (swapping && text) {
        const swapIn = still ? 0 : ease(progress(t, "scramble"));
        const swapOut = still ? 0 : ease(progress(t, "unscramble"));
        wordBox.style.width = `${lerp(fromWidth, toWidth, swapIn * (1 - swapOut))}px`;
        const nextText = still
          ? fromText
          : t < AT.unscramble
            ? wordScramble.at(fromText, toText, progress(t, "scramble"))
            : wordScramble.at(toText, fromText, progress(t, "unscramble"));
        if (nextText !== shownText) {
          text.textContent = nextText;
          shownText = nextText;
        }
      }

      const origin = layer.getBoundingClientRect();
      const wordRect = relative(wordBox.getBoundingClientRect(), origin);
      const headingRect = relative(heading.getBoundingClientRect(), origin);
      const x0 = wordRect.left - padX * fontSize;
      // Ink offsets are from the text's own box (baseline minus font ascent), which a
      // range over the text gives whatever the word's display is.
      const textBox = fitInk ? relative(rangeRect(text ?? wordBox), origin) : wordRect;
      const y0 = fitInk
        ? textBox.top + wordInkTop - 0.08 * fontSize
        : wordRect.top - 0.06 * fontSize;
      const x1 = wordRect.right + padRight * fontSize;
      const y1 = fitInk
        ? textBox.top + wordInkBottom + 0.06 * fontSize
        : wordRect.bottom + 0.04 * fontSize;
      const selection: Box = { left: x0, top: y0, right: x1, bottom: y1 };

      // The target, hung under the heading right of the selection when asked to.
      const press = !still && t >= AT.click && t < AT.lit ? 0.95 : 1;
      if (placeTargetUnderHeading) {
        const left = Math.min(x1 + Math.max(18, 0.6 * fontSize), origin.width - target.offsetWidth);
        target.style.transform = `translate3d(${left}px, ${headingRect.bottom + 8}px, 0) scale(${press})`;
      } else {
        target.style.transform = press === 1 ? "" : `scale(${press})`;
      }
      const targetRect = placeTargetUnderHeading
        ? (() => {
            const left = Math.min(
              x1 + Math.max(18, 0.6 * fontSize),
              origin.width - target.offsetWidth,
            );
            const top = headingRect.bottom + 8;
            return {
              left,
              top,
              right: left + target.offsetWidth,
              bottom: top + target.offsetHeight,
            };
          })()
        : relative(target.getBoundingClientRect(), origin);
      // "hug": run midway between the selection and the next line's ink, and turn
      // down just past the right edge of the copy's text (the text, not its box).
      let runY: number | null = null;
      let gutterX = targetRect.right;
      if (route === "hug") {
        if (overLine) {
          const inkTop = relative(rangeRect(overLine), origin).top + overInkOffset;
          const gap = inkTop - selection.bottom;
          runY = gap >= 3 ? selection.bottom + gap / 2 : null;
        }
        // Right of the copy and of the selection, so the drop never re-enters the box.
        gutterX = Math.max(gutterX, selection.right);
        for (const element of cleared) {
          gutterX = Math.max(gutterX, rangeRect(element).right - origin.left);
        }
        gutterX = Math.min(origin.width - 4, gutterX + 16);
      }
      const path = routeFor(route, selection, targetRect, { runY, gutterX });
      const portPoint = path[0]!;
      const endPoint = path[path.length - 1]!;
      // Where the cursor clicks: on the target, a little right of centre, as in the video.
      const clickPoint: Point = [
        lerp(targetRect.left, targetRect.right, 0.58),
        lerp(targetRect.top, targetRect.bottom, 0.62),
      ];

      // Selection: dragged open from the top-left, held, then released to the bottom-right.
      const drag = ease(progress(t, "drag"));
      const deselect = ease(progress(t, "deselect"));
      let rect: [number, number, number, number] | null = null;
      if (still) rect = [x0, y0, x1, y1];
      else if (t >= AT.drag && t < AT.release) {
        rect = [x0, y0, lerp(x0, x1, drag), lerp(y0, y1, drag)];
      } else if (t >= AT.release && t < LOOP_MS) {
        rect = [lerp(x0, x1, deselect), lerp(y0, y1, deselect), x1, y1];
      }
      if (rect) {
        select.style.opacity = String(1 - deselect);
        select.style.transform = `translate3d(${rect[0]}px, ${rect[1]}px, 0)`;
        select.style.width = `${Math.max(0, rect[2] - rect[0])}px`;
        select.style.height = `${Math.max(0, rect[3] - rect[1])}px`;
        select.toggleAttribute("data-corners", rect[2] - rect[0] > 12);
      } else {
        select.style.opacity = "0";
      }

      // Wire: drawn from the port to the cursor, then connected to the target.
      const wireAmount = still || t >= AT.connect ? 1 : ease(progress(t, "wire"));
      const unwire = still ? 0 : ease(progress(t, "unwire"));
      const drawn = partOf(path, wireAmount);
      if (still || (t >= AT.wire && t < AT.unscramble)) {
        wire.setAttribute("d", roundPath(drawn.points));
        wire.style.opacity = String(1 - unwire);
        port.setAttribute("cx", String(portPoint[0]));
        port.setAttribute("cy", String(portPoint[1]));
        port.style.opacity = String(1 - unwire);
      } else {
        wire.style.opacity = "0";
        port.style.opacity = "0";
      }
      const connected = still || (t >= AT.connect && t < AT.unscramble);
      end.setAttribute("cx", String(endPoint[0]));
      end.setAttribute("cy", String(endPoint[1]));
      end.style.opacity = connected ? String(1 - unwire) : "0";

      // The click's rings.
      ripples.forEach((ripple, index) => {
        const ring = still ? 0 : clamp((t - AT.click - index * RIPPLE_GAP_MS) / RIPPLE_MS);
        if (ring <= 0 || ring >= 1) {
          ripple!.style.opacity = "0";
          return;
        }
        ripple!.style.opacity = String(0.7 * (1 - ring));
        ripple!.style.transform = `translate3d(${clickPoint[0]}px, ${clickPoint[1]}px, 0) scale(${0.2 + 2.6 * ease(ring)})`;
      });

      // The target: a dashed target while the wire is dragged, linked once the
      // wire lands, hovered and pressed by the cursor, then lit.
      const state = still
        ? "on"
        : t < AT.toPort || t >= AT.unscramble
          ? "off"
          : t < AT.connect
            ? "target"
            : t < AT.toTarget
              ? "linked"
              : t < AT.click
                ? "hover"
                : t < AT.lit
                  ? "press"
                  : "on";
      if (target.dataset.swState !== state) target.dataset.swState = state;
      renderLabel(t);
      target.style.setProperty("--sw-fade", String(1 - unwire));

      // Cursor: glide in, drag the selection, move to the port, drag the wire, click, let go.
      let cursorPoint: Point | null = null;
      let pressed = false;
      let cursorOpacity = 1;
      if (!still) {
        if (t >= AT.glide && t < AT.press) {
          const glide = ease(progress(t, "glide"));
          cursorPoint = [lerp(x0 - 34, x0, glide), lerp(y0 - 26, y0, glide)];
          cursorOpacity = glide;
        } else if (t >= AT.press && t < AT.release) {
          cursorPoint = [lerp(x0, x1, drag), lerp(y0, y1, drag)];
          pressed = true;
        } else if (t >= AT.release && t < AT.toPort) {
          cursorPoint = [x1, y1];
        } else if (t >= AT.toPort && t < AT.grab) {
          const move = ease(progress(t, "toPort"));
          cursorPoint = [lerp(x1, portPoint[0], move), lerp(y1, portPoint[1], move)];
        } else if (t >= AT.grab && t < AT.connect) {
          cursorPoint = drawn.tip;
          pressed = true;
        } else if (t >= AT.connect && t < AT.toTarget) {
          cursorPoint = endPoint;
        } else if (t >= AT.toTarget && t < AT.click) {
          const move = ease(progress(t, "toTarget"));
          cursorPoint = [
            lerp(endPoint[0], clickPoint[0], move),
            lerp(endPoint[1], clickPoint[1], move),
          ];
        } else if (t >= AT.click && t < AT.hold) {
          cursorPoint = clickPoint;
          pressed = t < AT.lit;
        } else if (t >= AT.hold && t < AT.hold + CURSOR_LEAVE_MS) {
          const away = ease((t - AT.hold) / CURSOR_LEAVE_MS);
          cursorPoint = [clickPoint[0] + 10 * away, clickPoint[1] + 10 * away];
          cursorOpacity = 1 - away;
        }
      }
      if (cursorPoint) {
        cursor.style.opacity = String(cursorOpacity);
        cursor.style.transform = `translate3d(${cursorPoint[0] - 3}px, ${cursorPoint[1] - 2}px, 0) scale(${pressed ? 0.86 : 1})`;
      } else {
        cursor.style.opacity = "0";
      }
    };

    measure();
    let t = still ? HOLD_AT : 0;
    let held = 0;
    let visible = false;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!layer.isConnected) {
        frame = 0;
        return;
      }
      const delta = last ? Math.min(64, now - last) : 0;
      last = now;
      if (pauseZone?.matches(":focus-within")) {
        // Someone is filling in the form: clear the stage and wait.
        t = 0;
      } else {
        // While held, stay connected: the hold never ends.
        t = held > 0 && t >= AT.hold + DURATION.hold - 300 ? HOLD_AT : t + delta;
      }
      if (t >= LOOP_MS) {
        t -= LOOP_MS;
        wordScramble.reseed();
        labelScramble?.reseed();
      }
      render(t);
      frame = visible ? requestAnimationFrame(tick) : 0;
    };
    const start = () => {
      if (still || frame) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) start();
      },
      { threshold: 0.3 },
    );
    const resize = new ResizeObserver(() => {
      measure();
      render(t);
    });
    let disposed = false;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (disposed) return;
      measure();
      render(t);
      observer.observe(root);
      resize.observe(root);
    });

    const hold = () => {
      held += 1;
      if (still) return;
      if (t < AT.lit || t >= AT.unwire) t = HOLD_AT;
      render(t);
    };
    const letGo = () => {
      held = Math.max(0, held - 1);
    };
    const hoverTargets = holdOnTarget ? [wordBox, target] : [wordBox];
    for (const element of hoverTargets) {
      element.addEventListener("pointerenter", hold);
      element.addEventListener("pointerleave", letGo);
    }
    if (holdOnTarget) {
      target.addEventListener("focus", hold);
      target.addEventListener("blur", letGo);
    }
    const renderPauseState = () => render(t);
    pauseZone?.addEventListener("focusin", renderPauseState);
    pauseZone?.addEventListener("focusout", renderPauseState);
    render(t);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      for (const element of hoverTargets) {
        element.removeEventListener("pointerenter", hold);
        element.removeEventListener("pointerleave", letGo);
      }
      if (holdOnTarget) {
        target.removeEventListener("focus", hold);
        target.removeEventListener("blur", letGo);
      }
      pauseZone?.removeEventListener("focusin", renderPauseState);
      pauseZone?.removeEventListener("focusout", renderPauseState);
      delete target.dataset.swState;
      if (label && label.textContent === labelWritten && labelWritten !== labelFrom) {
        label.textContent = labelFrom;
        target.style.removeProperty("min-width");
      }
      target.style.removeProperty("--sw-fade");
      if (!placeTargetUnderHeading) target.style.transform = "";
    };
  }, [
    wordSelector,
    targetSelector,
    headingSelector,
    route,
    swapText,
    swapFrom,
    swapTo,
    placeTargetUnderHeading,
    holdOnTarget,
    pauseWithin,
    padX,
    padRight,
    labelSelector,
    labelTo,
    fitInk,
    over,
    clear,
  ]);

  return (
    <div aria-hidden className="farm-sw-layer" ref={layerRef}>
      <div className="farm-sw-select" ref={selectRef}>
        <span className="farm-sw-corner farm-sw-corner-tl" />
        <span className="farm-sw-corner farm-sw-corner-tr" />
        <span className="farm-sw-corner farm-sw-corner-bl" />
        <span className="farm-sw-corner farm-sw-corner-br" />
      </div>
      <svg className="farm-sw-wires">
        <path className="farm-sw-wire" ref={wireRef} />
        <circle className="farm-sw-end" r="3" ref={portRef} />
        <circle className="farm-sw-end" r="3" ref={endRef} />
      </svg>
      <span className="farm-sw-ripple" ref={rippleARef} />
      <span className="farm-sw-ripple" ref={rippleBRef} />
      {/* The launch video's cursor. */}
      <svg className="farm-sw-cursor" ref={cursorRef} viewBox="0 0 24 24">
        <path
          d="M4 2.5 19.5 10l-6.6 1.9L9.7 18.6z"
          fill="#fff"
          stroke="#000"
          strokeLinejoin="round"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
}
